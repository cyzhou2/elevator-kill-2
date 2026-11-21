/* ============================================================
 * render.js · 俯视 2D 绘制
 * ------------------------------------------------------------
 * 氛围三件套：暖黄手电锥 + 大片暗角 + 胶片颗粒/扫描线
 * 地面一次性烘焙成离屏图，之后每帧只做合成，手机上也不卡。
 * ============================================================ */
"use strict";

var Render = (function () {
  var cv = null, ctx = null, dpr = 1;
  var W = 0, H = 0;
  var baked = null, bakeS = 46;
  var lightCv = null, lightCtx = null;
  var grainPat = null, scanPat = null;
  var motes = [];
  var time = 0;
  var view = { s: 1, ox: 0, oy: 0, rotate: false };

  function hash(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext("2d");
    buildPatterns();
    initMotes();
  }

  function buildPatterns() {
    /* 颗粒 */
    var gs = 160;
    var gc = document.createElement("canvas");
    gc.width = gs; gc.height = gs;
    var g2 = gc.getContext("2d");
    var img = g2.createImageData(gs, gs);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 120 + Math.random() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    grainPat = ctx.createPattern(gc, "repeat");

    /* 扫描线 */
    var sc = document.createElement("canvas");
    sc.width = 4; sc.height = 4;
    var s2 = sc.getContext("2d");
    s2.fillStyle = "rgba(0,0,0,1)";
    s2.fillRect(0, 0, 4, 2);
    scanPat = ctx.createPattern(sc, "repeat");
  }

  function initMotes() {
    motes = [];
    for (var i = 0; i < CFG.LOOK.dust; i++) {
      motes.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.004 - Math.random() * 0.014,
        r: 0.4 + Math.random() * 1.3,
        a: 0.1 + Math.random() * 0.4,
        ph: Math.random() * 6.28
      });
    }
  }

  function resize() {
    var rect = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, Math.round(rect.width));
    H = Math.max(240, Math.round(rect.height));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    layout();
  }

  function layout() {
    var g = World.geom;
    if (!g) return;
    var p = World.player;
    var inCar = p && p.space === "car";
    var b;
    if (inCar) {
      /* 轿厢内：镜头推进轿厢，看得到面板 */
      var e = World.carById(p.carId);
      var car = (e && e.id === "D") ? g.elev.D.car : g.elev.C.car;
      b = { x: car.x - 0.85, y: car.y - 0.45, w: car.w + 1.7, h: car.h + 0.9 };
    } else {
      b = { x: g.minX, y: g.viewMinY, w: g.width, h: g.viewHeight };
    }
    /* 竖屏也不再旋转画面：楼道永远是同一个朝向 */
    var rotate = false;
    var availW = W - (W < 640 ? 8 : 20), availH = H - (H < 640 ? 8 : 20);
    var s = rotate ? Math.min(availH / b.w, availW / b.h) : Math.min(availW / b.w, availH / b.h);
    view = {
      s: s,
      rotate: rotate,
      inCar: !!inCar,
      ox: W / 2, oy: H / 2,
      cx: b.x + b.w / 2,
      cy: b.y + b.h / 2
    };
  }

  /* ---------- 烘焙静态平面 ---------- */

  function bake() {
    var g = World.geom;
    var w = Math.ceil(g.width * bakeS), h = Math.ceil(g.height * bakeS);
    baked = document.createElement("canvas");
    baked.width = w; baked.height = h;
    var c = baked.getContext("2d");
    c.translate(-g.minX * bakeS, -g.minY * bakeS);
    c.scale(bakeS, bakeS);

    var L = CFG.LOOK;

    /* 楼体外的虚空 */
    c.fillStyle = L.void;
    c.fillRect(g.minX, g.minY, g.width, g.height);

    /* 楼层地面 */
    drawSlab(c, g.corridor, "corr", 0.52);
    drawSlab(c, g.hall, "hall", 0.52);
    drawSlab(c, g.stairA, "stair", 0.6);
    drawSlab(c, g.stairB, "stair", 0.6);

    /* 电梯井 */
    for (var id in g.elev) {
      var car = g.elev[id].car;
      var sh = { x: car.x - 0.12, y: car.y - 0.12, w: car.w + 0.24, h: car.h + 0.24 };
      c.fillStyle = "#0c0e0e";
      c.fillRect(sh.x, sh.y, sh.w, sh.h);
      c.strokeStyle = "#191d1c";
      c.lineWidth = 0.05;
      c.strokeRect(sh.x, sh.y, sh.w, sh.h);
      /* 导轨 */
      c.strokeStyle = "#232726";
      c.lineWidth = 0.03;
      c.beginPath();
      c.moveTo(sh.x + 0.08, sh.y); c.lineTo(sh.x + 0.08, sh.y + sh.h);
      c.moveTo(sh.x + sh.w - 0.08, sh.y); c.lineTo(sh.x + sh.w - 0.08, sh.y + sh.h);
      c.stroke();
    }

    /* 楼梯踏步 */
    drawStairs(c, g.stairZoneA, 1);
    drawStairs(c, g.stairZoneB, -1);

    /* 踢脚线与墙面污渍 */
    c.save();
    c.globalAlpha = 0.5;
    c.strokeStyle = "#0e1011";
    c.lineWidth = 0.06;
    [g.corridor, g.hall, g.stairA, g.stairB].forEach(function (r) {
      c.strokeRect(r.x + 0.03, r.y + 0.03, r.w - 0.06, r.h - 0.06);
    });
    c.restore();

    /* 墙体：伪 3D 挤出（北墙有一点"高度"） */
    for (var i = 0; i < g.walls.length; i++) drawWall(c, g.walls[i]);

    /* 痕迹与杂物 */
    scatterFilth(c, g);
    bakeProps(c, g);

    /* 每层楼的编号牌 */
    bakeFloorSign(c, g);
  }

  function drawSlab(c, r, kind, tile) {
    var L = CFG.LOOK;
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.fillStyle = kind === "hall" ? L.hall : kind === "stair" ? L.stair : L.floor;
    c.fillRect(r.x, r.y, r.w, r.h);

    var cols = Math.ceil(r.w / tile) + 1, rows = Math.ceil(r.h / tile) + 1;
    var ox = r.x, oy = r.y;
    for (var i = 0; i < cols; i++) {
      for (var j = 0; j < rows; j++) {
        var h = hash(Math.round(ox + i) * 7.3 + oy * 3.1, j * 13.7 + i * 5.3);
        var x = ox + i * tile, y = oy + j * tile;
        c.fillStyle = h > 0.62 ? L.floorAlt : L.floor;
        if (kind === "hall") c.fillStyle = h > 0.5 ? L.hall : "#1c201c";
        if (kind === "stair") c.fillStyle = h > 0.5 ? L.stair : "#1f2222";
        c.fillRect(x, y, tile, tile);
        /* 砖缝 */
        c.strokeStyle = "rgba(10,13,14,0.55)";
        c.lineWidth = 0.016;
        c.strokeRect(x + 0.008, y + 0.008, tile - 0.016, tile - 0.016);
        /* 砖面斑点 */
        if (h > 0.86) {
          c.fillStyle = "rgba(0,0,0,0.18)";
          c.beginPath();
          c.ellipse(x + tile * hash(i, j), y + tile * hash(j, i), tile * 0.18, tile * 0.1, h * 3, 0, 6.283);
          c.fill();
        }
      }
    }
    /* 中间那道脏 */
    var grd = c.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grd.addColorStop(0, "rgba(0,0,0,0.34)");
    grd.addColorStop(0.5, "rgba(0,0,0,0.0)");
    grd.addColorStop(1, "rgba(0,0,0,0.42)");
    c.fillStyle = grd;
    c.fillRect(r.x, r.y, r.w, r.h);
    c.restore();
  }

  function drawWall(c, r) {
    var L = CFG.LOOK;
    c.fillStyle = L.wall;
    c.fillRect(r.x, r.y, r.w, r.h);
    /* 顶面高光 */
    c.fillStyle = L.wallTop;
    c.fillRect(r.x, r.y, r.w, Math.min(r.h, 0.055));
    /* 底边阴影 */
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(r.x, r.y + r.h - 0.05, r.w, 0.05);
    c.fillStyle = L.wallEdge;
    c.fillRect(r.x, r.y, 0.03, r.h);
    c.fillRect(r.x + r.w - 0.03, r.y, 0.03, r.h);
    /* 墙面剥落 */
    for (var i = 0; i < 3; i++) {
      var h = hash(r.x * 11 + i, r.y * 7 + i * 3);
      if (h < 0.55) continue;
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.beginPath();
      c.ellipse(r.x + r.w * hash(i, r.x), r.y + r.h * hash(r.y, i), r.w * 0.16 + 0.05, r.h * 0.28 + 0.03, 0, 0, 6.283);
      c.fill();
    }
  }

  function drawStairs(c, z, dir) {
    var steps = 12;
    var h = z.h / steps;
    for (var i = 0; i < steps; i++) {
      var y = z.y + i * h;
      c.fillStyle = i % 2 ? "#222625" : "#1d2120";
      c.fillRect(z.x, y, z.w, h);
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.lineWidth = 0.026;
      c.beginPath();
      c.moveTo(z.x, y + h);
      c.lineTo(z.x + z.w, y + h);
      c.stroke();
      c.strokeStyle = "rgba(190,200,195,0.045)";
      c.beginPath();
      c.moveTo(z.x, y + 0.012);
      c.lineTo(z.x + z.w, y + 0.012);
      c.stroke();
    }
    /* 扶手 */
    c.strokeStyle = "#33393a";
    c.lineWidth = 0.05;
    c.beginPath();
    c.moveTo(z.x + 0.04, z.y); c.lineTo(z.x + 0.04, z.y + z.h);
    c.moveTo(z.x + z.w - 0.04, z.y); c.lineTo(z.x + z.w - 0.04, z.y + z.h);
    c.stroke();
    /* 方向箭头 */
    c.strokeStyle = "rgba(180,190,185,0.13)";
    c.lineWidth = 0.05;
    var cx = z.x + z.w / 2;
    c.beginPath();
    if (dir > 0) { c.moveTo(cx, z.y + z.h * 0.78); c.lineTo(cx, z.y + z.h * 0.22); }
    else { c.moveTo(cx, z.y + z.h * 0.22); c.lineTo(cx, z.y + z.h * 0.78); }
    c.stroke();
  }

  function scatterFilth(c, g) {
    var areas = [g.corridor, g.hall];
    for (var i = 0; i < 90; i++) {
      var a = areas[i % areas.length];
      var x = a.x + hash(i, 1) * a.w;
      var y = a.y + hash(i, 2) * a.h;
      var s = 0.03 + hash(i, 3) * 0.16;
      c.fillStyle = "rgba(0,0,0," + (0.10 + hash(i, 4) * 0.22) + ")";
      c.beginPath();
      c.ellipse(x, y, s, s * (0.5 + hash(i, 5)), hash(i, 6) * 3, 0, 6.283);
      c.fill();
    }
    /* 几处水渍/血迹 */
    for (var j = 0; j < 8; j++) {
      var aa = areas[j % areas.length];
      var xx = aa.x + hash(j, 11) * aa.w;
      var yy = aa.y + hash(j, 12) * aa.h;
      var rr = 0.18 + hash(j, 13) * 0.42;
      var grd = c.createRadialGradient(xx, yy, 0, xx, yy, rr);
      grd.addColorStop(0, "rgba(58,14,14,0.30)");
      grd.addColorStop(1, "rgba(58,14,14,0)");
      c.fillStyle = grd;
      c.beginPath(); c.arc(xx, yy, rr, 0, 6.283); c.fill();
    }
    /* 碎屑 */
    for (var k = 0; k < 160; k++) {
      var A = areas[k % areas.length];
      var px = A.x + hash(k, 21) * A.w, py = A.y + hash(k, 22) * A.h;
      c.fillStyle = "rgba(150,150,140," + (0.05 + hash(k, 23) * 0.1) + ")";
      c.fillRect(px, py, 0.02, 0.02);
    }
  }

  /* 走廊里的固定物件（纯装饰 + 一点遮挡的视觉重量） */
  function bakeProps(c, g) {
    var y0 = g.corridor.y + 0.1, y1 = g.corridor.y + g.corridor.h - 0.1;
    /* 左段 */
    propBox(c, 4.3, y0, 0.42, 0.3, "#3a2320", "#5a2f2a");       // 消防栓
    propBox(c, 5.6, y1 - 0.34, 0.36, 0.34, "#1f2322", "#2b302e"); // 垃圾桶
    /* 右段 */
    propBox(c, g.L - 4.4, y1 - 0.32, 0.5, 0.3, "#26292a", "#33383a");
    propBox(c, g.L - 6.0, y0, 0.3, 0.34, "#24282a", "#2f3536");
    /* 电梯厅 */
    propBox(c, g.hallX0 + 0.35, g.hallY0 + 0.45, 0.5, 0.42, "#20231f", "#2b2f28"); // 沙发/花盆
    propBox(c, g.hallX1 - 0.85, g.hallY0 + 0.45, 0.5, 0.42, "#20231f", "#2b2f28");

    /* 厅里的墙面小物：消防栓箱（西）、告示牌（东）、地垫 */
    propBox(c, g.hallX0 + 0.06, g.hallY0 + 1.35, 0.3, 0.62, "#3a2622", "#5a3330");
    c.fillStyle = "rgba(200,90,80,0.32)";
    c.fillRect(g.hallX0 + 0.13, g.hallY0 + 1.44, 0.16, 0.06);

    c.fillStyle = "rgba(210,206,190,0.12)";
    c.fillRect(g.hallX1 - 0.44, g.hallY0 + 1.45, 0.32, 0.46);
    c.strokeStyle = "rgba(210,206,190,0.22)";
    c.lineWidth = 0.01;
    c.strokeRect(g.hallX1 - 0.44, g.hallY0 + 1.45, 0.32, 0.46);
    c.fillStyle = "rgba(30,34,32,0.55)";
    for (var li = 0; li < 6; li++) {
      c.fillRect(g.hallX1 - 0.4, g.hallY0 + 1.52 + li * 0.058, 0.2 - (li % 3) * 0.045, 0.015);
    }

    /* 门前地垫（踩上去会有更闷的脚步） */
    c.fillStyle = "rgba(28,32,30,0.55)";
    c.fillRect(g.hallCX - 1.1, g.hallY0 + 0.55, 2.2, 1.5);
    c.strokeStyle = "rgba(60,66,62,0.5)";
    c.lineWidth = 0.014;
    c.strokeRect(g.hallCX - 1.1, g.hallY0 + 0.55, 2.2, 1.5);
  }

  function propBox(c, x, y, w, h, fill, edge) {
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.fillRect(x + 0.04, y + 0.05, w, h);
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
    c.strokeStyle = edge;
    c.lineWidth = 0.025;
    c.strokeRect(x, y, w, h);
  }

  function bakeFloorSign(c, g) {
    /* 电梯厅北墙上的楼层牌 */
    c.save();
    c.fillStyle = "rgba(20,24,22,0.9)";
    c.fillRect(g.hallCX - 0.42, g.hallY0 - 0.3, 0.84, 0.2);
    c.strokeStyle = "rgba(140,150,140,0.25)";
    c.lineWidth = 0.02;
    c.strokeRect(g.hallCX - 0.42, g.hallY0 - 0.3, 0.84, 0.2);
    c.restore();
  }

  /* ---------- 变换 ---------- */

  function applyWorldTransform(c) {
    var g = World.geom;
    c.translate(view.ox, view.oy);
    if (view.rotate) c.rotate(-Math.PI / 2);
    c.scale(view.s, view.s);
    c.translate(-view.cx, -view.cy);
    return g;
  }

  function toWorld(px, py) {
    var g = World.geom;
    var x = px - view.ox, y = py - view.oy;
    if (view.rotate) {
      var rx = y, ry = -x;
      x = rx; y = ry;
    }
    return { x: x / view.s + view.cx, y: y / view.s + view.cy };
  }

  /* ---------- 光照 ---------- */

  function ensureLightCanvas() {
    var g = World.geom;
    var w = Math.ceil(g.width * bakeS), h = Math.ceil(g.height * bakeS);
    if (!lightCv || lightCv.width !== w || lightCv.height !== h) {
      lightCv = document.createElement("canvas");
      lightCv.width = w; lightCv.height = h;
      lightCtx = lightCv.getContext("2d");
    }
  }

  function buildLight(world, t) {
    ensureLightCanvas();
    var g = world.geom, p = world.player;
    var c = lightCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, lightCv.width, lightCv.height);
    c.translate(-g.minX * bakeS, -g.minY * bakeS);
    c.scale(bakeS, bakeS);

    var powered = !!(World.power && World.power[world.viewFloor]);
    var flick = World.flicker || 0;
    var dark = view.inCar ? 0.82 : (powered ? 0.7 : 0.865);
    var lightOff = !(p && p.lightOn);
    dark = Math.min(0.975, dark + flick * 0.22 + (lightOff ? 0.05 : 0));
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "rgba(2,3,3," + dark + ")";
    c.fillRect(g.minX, g.minY, g.width, g.height);

    c.globalCompositeOperation = "destination-out";

    /* 走廊应急灯：昏黄的小光池，带闪烁 */
    for (var i = 0; i < g.lamps.length; i++) {
      var lp = g.lamps[i];
      var flick = 0.82 + Math.sin(t * 5.1 + lp.phase) * 0.07 + Math.sin(t * 17.3 + lp.phase * 2) * 0.04;
      if (Math.random() < 0.004) flick *= 0.4;
      var r = lp.r * flick;
      var grd = c.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, r);
      grd.addColorStop(0, "rgba(0,0,0,0.50)");
      grd.addColorStop(0.55, "rgba(0,0,0,0.22)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = grd;
      c.beginPath(); c.arc(lp.x, lp.y, r, 0, 6.283); c.fill();
    }

    /* 玩家 */
    if (p && p.alive && p.space !== "stair") {
      var px = p.x, py = p.y;
      var f = 0.94 + Math.sin(t * 9.1) * 0.02 + Math.sin(t * 27.7) * 0.012;
      /* 贴身微光：关灯时只剩一小圈，开灯时更小（靠光锥照） */
      var amb = (p.lightOn ? 1.35 : 2.05) * f * (view.inCar ? 1.7 : 1);
      var ga = c.createRadialGradient(px, py, 0.05, px, py, amb);
      ga.addColorStop(0, "rgba(0,0,0,0.92)");
      ga.addColorStop(0.5, "rgba(0,0,0,0.5)");
      ga.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = ga;
      c.beginPath(); c.arc(px, py, amb, 0, 6.283); c.fill();

      if (p.lightOn) {
        var R = CFG.KID.vision * f * (p.space === "car" ? 0.55 : 1);
        var half = CFG.KID.fov;
        var ang = p.face;
        /* 外圈柔边 */
        var gf = c.createRadialGradient(px, py, 0.2, px, py, R * 1.12);
        gf.addColorStop(0, "rgba(0,0,0,0.55)");
        gf.addColorStop(0.62, "rgba(0,0,0,0.3)");
        gf.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gf;
        c.beginPath();
        c.moveTo(px, py);
        c.arc(px, py, R * 1.12, ang - half * 1.5, ang + half * 1.5);
        c.closePath(); c.fill();
        /* 主锥 */
        var gm = c.createRadialGradient(px, py, 0.25, px, py, R);
        gm.addColorStop(0, "rgba(0,0,0,0.95)");
        gm.addColorStop(0.6, "rgba(0,0,0,0.62)");
        gm.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gm;
        c.beginPath();
        c.moveTo(px, py);
        c.arc(px, py, R, ang - half, ang + half);
        c.closePath(); c.fill();
      }
    }

    /* 电梯门的缝光 */
    for (var e = 0; e < world.elevators.length; e++) {
      var el = world.elevators[e];
      if (el.openAmt > 0.15 && Math.abs(el.floor - world.viewFloor) < 0.06) {
        var gap = el.id === "C" ? g.elev.C.gap : g.elev.D.gap;
        var gg = c.createRadialGradient(gap.x + gap.w / 2, gap.y + gap.h, 0, gap.x + gap.w / 2, gap.y + gap.h, 1.6);
        gg.addColorStop(0, "rgba(0,0,0,0.55)");
        gg.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gg;
        c.beginPath(); c.arc(gap.x + gap.w / 2, gap.y + gap.h, 1.6, 0, 6.283); c.fill();
      }
    }

    c.globalCompositeOperation = "source-over";
  }

  /* ---------- 主绘制 ---------- */

  function draw(world, dt) {
    if (!baked || baked.__geom !== world.geom) { bake(); baked.__geom = world.geom; layout(); }
    time += dt || 0.016;

    if (view.inCar) { drawCarScene(world); return; }
    if (world.player && world.player.space === "stair") { drawStairScene(world); return; }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CFG.LOOK.bg;
    ctx.fillRect(0, 0, W, H);

    var shake = world.shake || 0;
    var sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * 9 * shake;
      sy = (Math.random() - 0.5) * 9 * shake;
    }

    ctx.save();
    ctx.translate(sx, sy);
    applyWorldTransform(ctx);
    var g = world.geom;

    /* 1. 地板 */
    ctx.drawImage(baked, g.minX, g.minY, g.width, g.height);

    /* 2. 血迹 */
    for (var b = 0; b < world.blood.length; b++) {
      var bl = world.blood[b];
      if (bl.floor !== world.viewFloor) continue;
      var gb = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.r);
      gb.addColorStop(0, "rgba(70,12,12," + bl.a + ")");
      gb.addColorStop(1, "rgba(50,8,8,0)");
      ctx.fillStyle = gb;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, 6.283); ctx.fill();
    }

    /* 3. 楼梯间门 */
    drawStairDoor(g, world, "A");
    drawStairDoor(g, world, "B");

    /* 4. 电梯 */
    for (var i = 0; i < world.elevators.length; i++) drawElevator(g, world, world.elevators[i]);
    drawObjectives(world);

    /* 5. 角色（只画看得见的） */
    drawActors(world);
    drawPrompts(world);

    /* 6. 光照遮罩 */
    buildLight(world, time);
    ctx.drawImage(lightCv, g.minX, g.minY, g.width, g.height);

    /* 7. 光柱里的暖色叠加（让手电有温度） */
    var p = world.player;
    if (p && p.alive && p.lightOn && p.space !== "stair") {
      ctx.globalCompositeOperation = "lighter";
      var gp = ctx.createRadialGradient(p.x, p.y, 0.1, p.x, p.y, CFG.KID.vision * 0.9);
      gp.addColorStop(0, "rgba(150,124,74,0.30)");
      gp.addColorStop(0.5, "rgba(110,90,54,0.13)");
      gp.addColorStop(1, "rgba(60,50,30,0)");
      ctx.fillStyle = gp;
      ctx.beginPath(); ctx.arc(p.x, p.y, CFG.KID.vision * 0.9, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();

    /* 7.5 吊灯的暖光池 */
    for (var li = 0; li < g.lamps.length; li++) {
      var lp = g.lamps[li];
      var fl = 0.86 + Math.sin(time * 5.1 + lp.phase) * 0.08 + Math.sin(time * 17.3 + lp.phase * 2) * 0.05;
      var lg = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lp.r * 1.15);
      var base = lp.warm ? "196,160,96" : "128,168,176";
      lg.addColorStop(0, "rgba(" + base + "," + (0.20 * fl).toFixed(3) + ")");
      lg.addColorStop(0.5, "rgba(" + base + "," + (0.08 * fl).toFixed(3) + ")");
      lg.addColorStop(1, "rgba(" + base + ",0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lp.x, lp.y, lp.r * 1.15, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    /* 8. 尘埃（屏幕空间，只在光附近显形） */
    drawMotes(world, dt);

    /* 9. 后期 */
    postFX(world);
  }

  /* ---------- 轿厢内近景 ---------- */
  /* 轿厢画面的方框（绘制/点击共用） */
  function carBox(w, h) {
    var compact = w < 700;
    var panelW = compact ? (w < 460 ? 168 : 190) : 0;
    var availW = w - panelW - 24;
    var bw = Math.min(compact ? availW : w * 0.56, 620);
    var bh = Math.min(h - 24, bw * 1.02);
    return { x: compact ? 12 : w * 0.5 - bw * 0.62, y: h * 0.5 - bh * 0.5, w: bw, h: bh, compact: compact, panelW: panelW };
  }

  /** 屏幕坐标 → 轿厢内的世界坐标（轿厢矩形 1.7×1.6 m） */
  function carToWorld(px, py) {
    var p = World.player;
    if (!p || p.space !== "car") return null;
    var e = World.carById(p.carId);
    if (!e) return null;
    var g = World.geom;
    var car = e.id === "C" ? g.elev.C.car : g.elev.D.car;
    var box = carBox(W, H);
    if (px < box.x - 10 || px > box.x + box.w + 10 || py < box.y - 10 || py > box.y + box.h + 10) return null;
    /* 点在下沿（门缝）或门外 → 目标给到大厅，人就会走过去出门 */
    if (py > box.y + box.h - 6) {
      return { x: car.x + car.w * 0.5, y: World.geom.hallY0 + 0.26 };
    }
    var tx = (px - box.x) / box.w, ty = (py - box.y) / box.h;
    return {
      x: car.x + Math.max(0.08, Math.min(1, tx)) * car.w,
      y: car.y + Math.max(0.08, Math.min(0.86, ty)) * car.h
    };
  }

  function drawCarScene(world) {
    var p = world.player;
    var e = p && p.space === "car" ? world.carById(p.carId) : null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0d0e";
    ctx.fillRect(0, 0, W, H);

    var box = carBox(W, H);
    var boxW = box.w, boxH = box.h, x0 = box.x, y0 = box.y;
    var x1 = x0 + boxW, y1 = y0 + boxH;

    /* 轿厢地板 */
    var grd = ctx.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, "#2c3231");
    grd.addColorStop(0.5, "#262b2b");
    grd.addColorStop(1, "#1d2221");
    ctx.fillStyle = grd;
    ctx.fillRect(x0, y0, boxW, boxH);

    /* 地板纹路 */
    ctx.strokeStyle = "rgba(10,13,13,0.55)";
    ctx.lineWidth = 1;
    var step = boxW / 9;
    for (var i = 1; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(x0 + i * step, y0); ctx.lineTo(x0 + i * step, y1); ctx.stroke();
    }
    for (var j = 1; j < 9; j++) {
      ctx.beginPath(); ctx.moveTo(x0, y0 + j * step); ctx.lineTo(x1, y0 + j * step); ctx.stroke();
    }

    /* 三面墙 */
    ctx.fillStyle = "#151a1a";
    ctx.fillRect(x0 - 14, y0 - 14, boxW + 28, 14);
    ctx.fillRect(x0 - 14, y1, boxW + 28, 14);
    ctx.fillRect(x0 - 14, y0, 14, boxH);
    ctx.fillRect(x1, y0, 14, boxH);
    ctx.strokeStyle = "#39423f";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 13.5, y0 - 13.5, boxW + 27, 13.5);
    ctx.strokeRect(x0 - 13.5, y1, boxW + 27, 13.5);

    /* 扶手 */
    ctx.strokeStyle = "#4a5350";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 16, y0 + 26); ctx.lineTo(x1 - 16, y0 + 26);
    ctx.moveTo(x0 + 16, y1 - 26); ctx.lineTo(x1 - 16, y1 - 26);
    ctx.stroke();

    /* 顶灯 */
    var flick = 0.9 + Math.sin(time * 11.3) * 0.05 + Math.sin(time * 31.7) * 0.03;
    if (Math.random() < 0.01) flick *= 0.5;
    var lamp = ctx.createRadialGradient(x0 + boxW / 2, y0 + boxH * 0.38, 4, x0 + boxW / 2, y0 + boxH * 0.38, boxW * 0.62);
    lamp.addColorStop(0, "rgba(214,206,176," + (0.20 * flick).toFixed(3) + ")");
    lamp.addColorStop(0.5, "rgba(170,166,140," + (0.07 * flick).toFixed(3) + ")");
    lamp.addColorStop(1, "rgba(120,120,100,0)");
    ctx.fillStyle = lamp;
    ctx.fillRect(x0, y0, boxW, boxH);

    /* 门缝：底边一丝走廊的光 */
    var slit = ctx.createLinearGradient(0, y1 - 10, 0, y1 + 12);
    slit.addColorStop(0, "rgba(190,170,120,0)");
    slit.addColorStop(0.5, "rgba(190,170,120,0.20)");
    slit.addColorStop(1, "rgba(190,170,120,0)");
    ctx.fillStyle = slit;
    ctx.fillRect(x0, y1 - 10, boxW, 24);

    /* 轿厢里所有人：按真实坐标换算，别人就在你旁边 */
    var gg = World.geom;
    var carRect = e ? (e.id === "C" ? gg.elev.C.car : gg.elev.D.car) : null;
    if (carRect && world.actors) {
      var boxPt = function (ax, ay) {
        return {
          x: x0 + ((ax - carRect.x) / carRect.w) * boxW,
          y: y0 + ((ay - carRect.y) / carRect.h) * boxH
        };
      };
      var list = world.actors.slice().sort(function (a, b) {
        return (a.controlled ? 1 : 0) - (b.controlled ? 1 : 0);
      });
      for (var ai = 0; ai < list.length; ai++) {
        var av = list[ai];
        if (!av.alive) continue;
        if (av.space !== "car" || av.carId !== (e && e.id)) continue;
        var q = boxPt(av.x, av.y);
        if (av.kind === "killer") {
          /* 很高、很黑，只有一点红光 */
          var flick2 = 0.72 + Math.sin(world.time * 2.7) * 0.12;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.beginPath(); ctx.ellipse(q.x + 4, q.y + 12, 16, 9, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = "#07080a";
          ctx.beginPath(); ctx.ellipse(q.x, q.y - 6, 15, 26, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = "#0b0c0e";
          ctx.beginPath(); ctx.arc(q.x, q.y - 30, 11, 0, 6.283); ctx.fill();
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = "rgba(190,60,50," + (0.5 * flick2).toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(q.x - 3, q.y - 31, 1.7, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.arc(q.x + 3, q.y - 31, 1.7, 0, 6.283); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.beginPath(); ctx.ellipse(q.x + 3, q.y + 7, 12, 7, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = av.controlled ? "#b3c1bc" : "#8f9c97";
          ctx.beginPath(); ctx.ellipse(q.x, q.y, 12, 10, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = av.controlled ? "#c9d5d0" : "#9aa7a2";
          ctx.beginPath(); ctx.arc(q.x, q.y - 2, 7, 0, 6.283); ctx.fill();
        }
      }
    }

    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.92)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    crt(world, time);
  }

  /* ---------- 楼梯过场（上下楼时看到的楼梯） ---------- */
  function drawStairScene(world) {
    var p = world.player, s = p && p.stair;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#080a0a";
    ctx.fillRect(0, 0, W, H);
    if (!s) return;

    var prog = Math.max(0, Math.min(1, s.t / s.dur));
    var tt = s.dir > 0 ? prog : 1 - prog;

    var n = 14;
    var x0 = W * 0.12, x1 = W * 0.88;
    var yB = H * 0.84, yT = H * 0.24;

    /* 楼梯间墙面 */
    var wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#0d1010");
    wall.addColorStop(0.5, "#121616");
    wall.addColorStop(1, "#0a0d0d");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    /* 台阶：踏面 + 踢面，下面填成实体，读起来才像楼梯 */
    for (var i = 0; i < n; i++) {
      var a0 = i / n, a1 = (i + 1) / n;
      var xa = x0 + (x1 - x0) * a0, xb = x0 + (x1 - x0) * a1;
      var ya = yB + (yT - yB) * a0;
      /* 踏面（从这条线一直填到画面底部） */
      ctx.fillStyle = i % 2 ? "#1b1f1f" : "#202525";
      ctx.fillRect(xa, ya, xb - xa + 1, yB + 90 - ya);
      /* 踏面前缘高光 */
      ctx.strokeStyle = "rgba(190,200,196,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xa, ya + 0.5);
      ctx.lineTo(xb, ya + 0.5);
      ctx.stroke();
      /* 踢面阴影 */
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(xa, ya, 2, yB + 90 - ya);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xa, yB + 90);
      ctx.stroke();
    }
    /* 楼梯底面阴影 */
    var sg = ctx.createLinearGradient(0, yT, 0, H);
    sg.addColorStop(0, "rgba(0,0,0,0)");
    sg.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, yT, W, H - yT);

    /* 扶手 */
    ctx.strokeStyle = "#39413f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0 - 20, yB - 52);
    ctx.lineTo(x1 + 20, yT - 52);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (var k = 0; k <= 6; k++) {
      var t2 = k / 6;
      var bx = x0 + (x1 - x0) * t2, by = yB + (yT - yB) * t2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - 52);
      ctx.stroke();
    }

    /* 人物 */
    var px = x0 + (x1 - x0) * tt;
    var py = yB + (yT - yB) * tt;
    var bob = Math.sin(s.t * 9) * 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath(); ctx.ellipse(px + 4, py + 2, 15, 6, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#b7c4bf";
    ctx.beginPath(); ctx.ellipse(px, py - 22 + bob, 11, 15, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#cdd8d4";
    ctx.beginPath(); ctx.arc(px, py - 42 + bob, 8, 0, 6.283); ctx.fill();

    /* 手电光 */
    var lg = ctx.createRadialGradient(px, py - 22, 4, px, py - 22, 240);
    lg.addColorStop(0, "rgba(214,190,130,0.16)");
    lg.addColorStop(0.5, "rgba(160,150,110,0.06)");
    lg.addColorStop(1, "rgba(120,120,90,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(px, py - 22, 240, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    /* 楼层字 */
    ctx.font = "700 30px ui-monospace, monospace";
    ctx.fillStyle = "rgba(230,217,182,0.92)";
    ctx.textAlign = "left";
    ctx.fillText(s.from + "F", 26, H - 64);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(201,168,106,0.9)";
    ctx.fillText(s.to + "F", W - 26, 56);
    ctx.textAlign = "left";

    /* 进度条 */
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(26, H - 22, W - 52, 2);
    ctx.fillStyle = "rgba(201,168,106,0.55)";
    ctx.fillRect(26, H - 22, (W - 52) * prog, 2);

    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    crt(world, time);
  }

  function drawStairDoor(g, world, L) {
    var d = world.stairDoors[world.viewFloor][L];
    var info = L === "A" ? g.stairDoorA : g.stairDoorB;
    var r = info.rect;
    var amt = d.amt;
    ctx.save();
    /* 门框 */
    ctx.fillStyle = "#14181a";
    ctx.fillRect(r.x, r.y - 0.04, r.w, r.h + 0.08);

    /* 被砸烂的门：只剩半扇斜靠在框上 */
    if (d.broken) {
      ctx.fillStyle = "#262a29";
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.2, r.y + r.h * 0.1);
      ctx.lineTo(r.x + r.w * 0.75, r.y + r.h * 0.02);
      ctx.lineTo(r.x + r.w * 0.9, r.y + r.h * 0.55);
      ctx.lineTo(r.x + r.w * 0.35, r.y + r.h * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#383e3c";
      ctx.lineWidth = 0.018;
      ctx.stroke();
      /* 地上的碎木 */
      ctx.fillStyle = "rgba(70,62,50,0.5)";
      ctx.fillRect(r.x + r.w * 0.1, r.y + r.h * 0.78, 0.1, 0.03);
      ctx.fillRect(r.x + r.w * 0.6, r.y + r.h * 0.85, 0.07, 0.025);
      ctx.restore();
      return;
    }

    /* 门扇：以铰链为轴旋转 */
    var hingeY = r.y + r.h;
    var hingeX = L === "A" ? r.x + r.w : r.x;
    var a = amt * (Math.PI * 0.46) * (L === "A" ? -1 : 1);
    ctx.translate(hingeX, hingeY);
    ctx.rotate(a);
    var leafLen = r.h;
    var dirSign = L === "A" ? -1 : 1;   // 门往楼梯间里开
    ctx.fillStyle = amt > 0.02 ? "#2c3130" : "#262b2a";
    ctx.fillRect(0, -leafLen, dirSign * 0.075, leafLen);
    ctx.strokeStyle = "#3d4442";
    ctx.lineWidth = 0.02;
    ctx.strokeRect(0, -leafLen, dirSign * 0.075, leafLen);
    /* 把手 */
    ctx.fillStyle = "#6b6455";
    ctx.beginPath();
    ctx.arc(dirSign * 0.05, -leafLen * 0.18, 0.035, 0, 6.283);
    ctx.fill();
    ctx.restore();

    /* 正在被砸：门框上一条红色读条 */
    if (d.breaking > 0.01) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(r.x + r.w * 0.1, r.y - 0.15, r.w * 0.8, 0.06);
      ctx.fillStyle = "rgba(190,60,50,0.9)";
      ctx.fillRect(r.x + r.w * 0.1, r.y - 0.15, r.w * 0.8 * Math.min(1, d.breaking), 0.06);
      ctx.restore();
    }
  }

  function drawElevator(g, world, e) {
    var gap = e.id === "C" ? g.elev.C.gap : g.elev.D.gap;
    var near = Math.abs(e.floor - world.viewFloor) < 0.06;
    var amt = near ? e.openAmt : 0;

    /* 门框 */
    ctx.fillStyle = "#0e1112";
    ctx.fillRect(gap.x - 0.05, gap.y - 0.02, gap.w + 0.1, gap.h + 0.02);

    /* 轿厢：只有门开着 / 半开时才看得见里面 */
    if (near) {
      var car = e.id === "C" ? g.elev.C.car : g.elev.D.car;
      if (amt > 0.05) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, amt * 1.4);
        ctx.fillStyle = "#232726";
        ctx.fillRect(car.x, car.y, car.w, car.h);
        /* 轿厢地板纹 */
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 0.02;
        for (var i = 1; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(car.x, car.y + (car.h / 5) * i);
          ctx.lineTo(car.x + car.w, car.y + (car.h / 5) * i);
          ctx.stroke();
        }
        /* 扶手 */
        ctx.strokeStyle = "#3a403e";
        ctx.lineWidth = 0.045;
        ctx.strokeRect(car.x + 0.12, car.y + 0.12, car.w - 0.24, car.h - 0.24);
        ctx.restore();
      }
    }

    /* 门扇（两片对开，向上滑出视野外侧打开） */
    var leafW = gap.w / 2;
    var open = amt * leafW * 0.94;
    ctx.fillStyle = "#1b2022";
    ctx.fillRect(gap.x - open, gap.y, leafW, gap.h);
    ctx.fillRect(gap.x + leafW + open, gap.y, leafW, gap.h);
    ctx.strokeStyle = "#39413f";
    ctx.lineWidth = 0.022;
    ctx.strokeRect(gap.x - open, gap.y, leafW, gap.h);
    ctx.strokeRect(gap.x + leafW + open, gap.y, leafW, gap.h);

    /* 门上方的小显示屏：楼层 + 方向 */
    var cy = gap.y + gap.h + 0.26;
    ctx.save();
    ctx.fillStyle = "rgba(10,12,12,0.95)";
    ctx.fillRect(gap.x + gap.w / 2 - 0.22, cy - 0.1, 0.44, 0.17);
    ctx.strokeStyle = "rgba(120,40,36,0.5)";
    ctx.lineWidth = 0.015;
    ctx.strokeRect(gap.x + gap.w / 2 - 0.22, cy - 0.1, 0.44, 0.17);
    var known = near || (world.panelVisible && world.panelVisible());
    ctx.fillStyle = "#c25a4a";
    ctx.font = "0.13px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var txt = near ? (Math.round(e.floor) + "F" + (e.dir > 0 ? "▲" : e.dir < 0 ? "▼" : "")) : "--";
    ctx.fillText(txt, gap.x + gap.w / 2, cy - 0.012);
    ctx.restore();
  }

  /* ---------- 目标物：配电箱 + 1F 紧急按钮 ---------- */
  function drawObjectives(world) {
    var p = world.player;
    if (!p || !p.alive) return;
    var lit = 1;

    /* 每层的配电箱 */
    for (var i = 0; i < world.fuses.length; i++) {
      var f = world.fuses[i];
      if (f.floor !== world.viewFloor) continue;
      var prog = f.prog || 0;
      var w2 = 0.34, h2 = 0.3;
      /* 箱体（贴墙） */
      ctx.fillStyle = f.done ? "#25302a" : "#2a2521";
      ctx.fillRect(f.x - w2 / 2, f.y - h2 - 0.06, w2, h2);
      ctx.strokeStyle = f.done ? "#3f5a4c" : "#4a3f34";
      ctx.lineWidth = 0.02;
      ctx.strokeRect(f.x - w2 / 2, f.y - h2 - 0.06, w2, h2);
      /* 指示灯：没修好是红光慢闪，修好是绿光常亮 */
      var pulse = f.done ? 1 : 0.45 + 0.35 * Math.sin(world.time * 3.2 + i);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var lg = ctx.createRadialGradient(f.x, f.y - 0.2, 0.01, f.x, f.y - 0.2, 0.9);
      lg.addColorStop(0, f.done ? "rgba(120,220,160," + 0.3 * pulse + ")" : "rgba(230,80,60," + 0.34 * pulse + ")");
      lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(f.x - 0.9, f.y - 1.1, 1.8, 1.8);
      ctx.restore();
      ctx.fillStyle = f.done ? "#8fe0b0" : "#e05a4a";
      ctx.beginPath();
      ctx.arc(f.x, f.y - 0.2, 0.045, 0, 6.283);
      ctx.fill();

      /* 修理进度环 */
      if (!f.done && prog > 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 0.42, 0, 6.283);
        ctx.stroke();
        ctx.strokeStyle = "rgba(201,168,106,0.95)";
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 0.42, -Math.PI / 2, -Math.PI / 2 + 6.283 * prog);
        ctx.stroke();
      }
    }

    /* 1F 大厅的紧急按钮（全部修好后亮起） */
    if (world.viewFloor === 1) {
      var g = World.geom;
      var ex = g.hallCX - 1.6, ey = g.hallY0 + 0.55;
      var ready = !!(world.allFusesDone && world.allFusesDone());
      /* 面板 */
      ctx.fillStyle = "#2b2320";
      ctx.fillRect(ex - 0.22, ey - 0.42, 0.44, 0.42);
      ctx.strokeStyle = ready ? "#7a5f31" : "#3a332c";
      ctx.lineWidth = 0.02;
      ctx.strokeRect(ex - 0.22, ey - 0.42, 0.44, 0.42);
      /* 按钮 */
      var pl = ready ? (0.6 + 0.4 * Math.sin(world.time * 4)) : 0.25;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var lg2 = ctx.createRadialGradient(ex, ey, 0.01, ex, ey, 1.1);
      lg2.addColorStop(0, "rgba(230,190,110," + 0.36 * pl + ")");
      lg2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg2;
      ctx.fillRect(ex - 1.1, ey - 1.1, 2.2, 2.2);
      ctx.restore();
      ctx.fillStyle = ready ? "#e6c07a" : "#6b5a44";
      ctx.beginPath();
      ctx.arc(ex, ey - 0.12, 0.1, 0, 6.283);
      ctx.fill();
    }
  }

  /* ---------- 交互图标：走近可交互物，飘出一个圆形按钮 ---------- */
  function drawPrompts(world) {
    var list = world.prompts ? world.prompts() : [];
    if (!list.length) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (var i = 0; i < list.length; i++) {
      var pr = list[i];
      var s = w2s(pr.x, pr.y);
      if (s.x < 30 || s.x > W - 30 || s.y < 30 || s.y > H - 30) continue;
      var R = pr.near ? 19 : 15;
      var alpha = pr.near ? 1 : 0.45;

      ctx.globalAlpha = alpha;
      /* 外环 */
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, 0, 6.283);
      ctx.fillStyle = "rgba(10,13,13,0.86)";
      ctx.fill();
      ctx.strokeStyle = pr.near ? "rgba(201,168,106,0.95)" : "rgba(140,150,146,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      /* 读条（修理 / 被砸） */
      var prog = pr.kind === "door" ? (pr.breaking || 0) : (pr.progress || 0);
      if (prog > 0.01) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, R + 4, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.min(1, prog));
        ctx.strokeStyle = pr.kind === "door" ? "rgba(190,60,50,0.95)" : "rgba(201,168,106,0.95)";
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      /* 图标 */
      ctx.strokeStyle = pr.near ? "#e8dcc0" : "#9aa7a2";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2;
      var cxx = s.x, cyy = s.y;
      if (pr.icon === "bolt") {
        /* 闪电 */
        ctx.beginPath();
        ctx.moveTo(cxx + 3, cyy - 8);
        ctx.lineTo(cxx - 4, cyy + 1);
        ctx.lineTo(cxx + 1, cyy + 1);
        ctx.lineTo(cxx - 2, cyy + 8);
        ctx.lineTo(cxx + 5, cyy - 2);
        ctx.lineTo(cxx, cyy - 2);
        ctx.closePath();
        ctx.fill();
      } else if (pr.icon === "exit") {
        /* 箭头出门 */
        ctx.beginPath();
        ctx.moveTo(cxx - 6, cyy - 7);
        ctx.lineTo(cxx + 2, cyy - 7);
        ctx.lineTo(cxx + 2, cyy + 7);
        ctx.lineTo(cxx - 6, cyy + 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cxx + 2, cyy);
        ctx.lineTo(cxx + 9, cyy);
        ctx.moveTo(cxx + 6, cyy - 3);
        ctx.lineTo(cxx + 9, cyy);
        ctx.lineTo(cxx + 6, cyy + 3);
        ctx.stroke();
      } else {
        /* 门 */
        ctx.strokeRect(cxx - 5, cyy - 8, 10, 16);
        ctx.beginPath();
        ctx.arc(cxx + 2.5, cyy, 1.4, 0, 6.283);
        ctx.fill();
      }

      /* 文案 */
      if (pr.near) {
        ctx.globalAlpha = 0.95;
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(8,10,10,0.8)";
        var tw = ctx.measureText(pr.label).width;
        ctx.fillRect(s.x - tw / 2 - 5, s.y + R + 6, tw + 10, 15);
        ctx.fillStyle = "#d8e0da";
        ctx.fillText(pr.label, s.x, s.y + R + 17);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function litAmount(world, x, y) {
    var p = world.player;
    if (!p || !p.alive) return 0;
    var d = World.dist(p.x, p.y, x, y);
    var amb = CFG.KID.ambient * 1.1;
    if (d < amb) return 1;
    if (!p.lightOn) return Math.max(0, 1 - d / amb);
    var ang = Math.atan2(y - p.y, x - p.x);
    var diff = Math.abs(Geom.angDiff(ang, p.face));
    var half = CFG.KID.fov * 1.15;
    if (diff > half) return Math.max(0, 1 - d / (amb * 1.4));
    var t = 1 - d / CFG.KID.vision;
    var edge = 1 - (diff / half) * 0.65;
    return Math.max(0, t * edge);
  }

  function drawActors(world) {
    var _recover = 0;
    var list = world.actors;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.alive) continue;
      if (a.space === "stair") continue;
      if (a.space === "car") {
        var e = world.carById(a.carId);
        if (!e || Math.abs(e.floor - world.viewFloor) > 0.06 || e.openAmt < 0.2) continue;
      } else if (a.floor !== world.viewFloor) continue;

      var lit = a.controlled ? 1 : litAmount(world, a.x, a.y);
      if (lit <= 0.04) continue;
      if (!a.controlled && a.space === "floor" && !World.los(world.viewFloor, world.player.x, world.player.y, a.x, a.y)) continue;

      if (a.kind === "kid") drawKid(a, lit);
      else drawKiller(a, lit, world);
    }
    /* 玩家最后画，保证在最上层 */
    var p = world.player;
    if (p && p.alive && p.space !== "stair") drawKid(p, 1, true);
  }

  function drawKid(a, lit, isPlayer) {
    var r = CFG.KID.radius;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + lit * 0.9);
    /* 影子 */
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(a.x + 0.05, a.y + 0.07, r * 1.05, r * 0.7, 0, 0, 6.283);
    ctx.fill();
    /* 身体：肩部略宽的一小团 */
    ctx.fillStyle = isPlayer ? "#b3c1bc" : "#7f8b87";
    ctx.beginPath();
    ctx.ellipse(a.x, a.y, r * 0.62, r * 0.5, 0, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
    /* 头 */
    ctx.fillStyle = isPlayer ? "#c9d5d0" : "#94a09c";
    ctx.beginPath();
    ctx.arc(a.x, a.y - 0.01, r * 0.34, 0, 6.283);
    ctx.fill();
    /* 朝向（很淡的一点） */
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(a.x + Math.cos(a.face) * r * 0.9, a.y + Math.sin(a.face) * r * 0.9);
    ctx.lineTo(a.x + Math.cos(a.face) * r * 1.35, a.y + Math.sin(a.face) * r * 1.35);
    ctx.stroke();
    ctx.restore();
  }

  function drawKiller(a, lit, world) {
    var r = CFG.KILLER.radius;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.25 + lit * 1.1);
    /* 地上拖着的黑影 */
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.ellipse(a.x + 0.05, a.y + 0.08, r * 1.15, r * 0.8, 0, 0, 6.283);
    ctx.fill();
    /* 身体 */
    ctx.fillStyle = "#08090a";
    ctx.beginPath();
    ctx.ellipse(a.x, a.y, r * 0.95, r * 0.8, 0, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,30,30,0.35)";
    ctx.lineWidth = 0.03;
    ctx.stroke();
    /* 两个亮点（眼睛） */
    var ex = Math.cos(a.face) * r * 0.45, ey = Math.sin(a.face) * r * 0.45;
    var perpX = -Math.sin(a.face) * r * 0.28, perpY = Math.cos(a.face) * r * 0.28;
    ctx.fillStyle = "rgba(220,60,60," + (0.5 + lit * 0.5) + ")";
    ctx.beginPath(); ctx.arc(a.x + ex + perpX, a.y + ey + perpY, 0.028, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x + ex - perpX, a.y + ey - perpY, 0.028, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  function drawMotes(world, dt) {
    var p = world.player;
    if (!p) return;
    var g = world.geom;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var s = view.s;
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < 0) m.x = 1; if (m.x > 1) m.x = 0;
      if (m.y < 0) m.y = 1; if (m.y > 1) m.y = 0;
      /* 世界坐标 */
      var wx = p.x + (m.x - 0.5) * CFG.KID.vision * 1.8;
      var wy = p.y + (m.y - 0.5) * CFG.KID.vision * 1.4;
      var d = World.dist(p.x, p.y, wx, wy);
      if (d > CFG.KID.vision) continue;
      var near = World.dist(p.x, p.y, wx, wy);
      var alpha = m.a * (1 - d / CFG.KID.vision) * 0.9;
      if (!p.lightOn) alpha *= 0.35;
      var sp = w2s(wx, wy);
      ctx.fillStyle = "rgba(226,214,180," + alpha.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, m.r, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 世界坐标 → 屏幕坐标（含竖屏旋转） */
  function w2s(x, y) {
    var dx = (x - view.cx) * view.s;
    var dy = (y - view.cy) * view.s;
    if (view.rotate) {
      var rx = dy, ry = -dx;
      return { x: view.ox + rx, y: view.oy + ry };
    }
    return { x: view.ox + dx, y: view.oy + dy };
  }

  function crt(world, t) {
    var flickAmt = World.flicker || 0;
    var dread = World.carDread || 0;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var L = CFG.LOOK;
    /* 扫描线 */
    if (scanPat) {
      ctx.globalAlpha = L.scanline;
      ctx.fillStyle = scanPat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    /* 颗粒 */
    if (grainPat) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.24, L.grain * (1 + flickAmt * 2.4 + dread * 1.1));
      ctx.globalCompositeOperation = "overlay";
      ctx.translate((Math.random() * 160) | 0, (Math.random() * 160) | 0);
      ctx.fillStyle = grainPat;
      ctx.fillRect(-160, -160, W + 320, H + 320);
      ctx.restore();
    }
    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.7, "rgba(0,0,0,0.34)");
    vg.addColorStop(1, "rgba(0,0,0,0.92)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* 紧张时四周渗血 */
    /* 轿厢里有别人：四周压得更死 */
    if (dread > 0.01) {
      var dv = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.18, W / 2, H * 0.5, Math.max(W, H) * 0.62);
      dv.addColorStop(0, "rgba(0,0,0,0)");
      dv.addColorStop(1, "rgba(0,0,0," + (0.55 * dread).toFixed(3) + ")");
      ctx.fillStyle = dv;
      ctx.fillRect(0, 0, W, H);
      var rp = 0.5 + 0.5 * Math.sin(t * 2.4);
      ctx.fillStyle = "rgba(120,30,26," + (0.05 * dread * rp).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    /* 灯闪：整屏压黑一下，边缘抽搐 */
    if (flickAmt > 0.01) {
      ctx.fillStyle = "rgba(0,0,0," + (0.34 * flickAmt).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    var tn = world.tension || 0;
    if (tn > 0.02) {
      var pulse = 0.55 + Math.sin(t * 7) * 0.45;
      var rv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
      rv.addColorStop(0, "rgba(0,0,0,0)");
      rv.addColorStop(1, "rgba(96,10,10," + (0.30 * tn * pulse).toFixed(3) + ")");
      ctx.fillStyle = rv;
      ctx.fillRect(0, 0, W, H);
    }
    /* 被抓瞬间的红闪 */
    if (world.flash > 0.01) {
      ctx.fillStyle = "rgba(150,20,20," + (0.42 * world.flash).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function postFX(world) { crt(world, time); }

  return {
    init: init,
    resize: resize,
    layout: layout,
    draw: draw,
    bake: bake,
    toWorld: toWorld,
    carToWorld: carToWorld, carBox: carBox,
    w2s: w2s,
    get view() { return view; },
    get size() { return { W: W, H: H }; }
  };
})();
