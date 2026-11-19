/* ============================================================
 * geom.js · 楼层平面（全部用「米」为单位）
 * ------------------------------------------------------------
 * 一层的俯视平面（x 向右、y 向下）：
 *
 *        y=-3.3 ┌──────┐C门┌──┐D门┌──────┐
 *               │                         │   ← 电梯厅（向北凹进）
 *        y=  0  ├──────┘  电梯厅  └───────┤
 *   楼梯间A     │  走廊 ............ 走廊  │      楼梯间B
 *        y=2.9  ├─────────────────────────┤
 *               │ 楼梯 │                 │ 楼梯 │
 *        y=6.4  └──────┘                 └──────┘
 *
 * 只有当前楼层会被渲染，所以这里只描述「一层」。
 * ============================================================ */
"use strict";

var Geom = (function () {
  var C = null;
  var G = null;

  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  function build(cfg) {
    C = cfg;
    var L = cfg.FLOOR_LEN;
    var sw = cfg.STAIR_W, sd = cfg.STAIR_D;
    var cw = cfg.CORRIDOR_W, hw = cfg.HALL_W, hd = cfg.HALL_D;
    var t = cfg.WALL_T, dw = cfg.DOOR_W;
    var carW = cfg.CAR_W, carD = cfg.CAR_D;

    var hallCX = L / 2;
    var hallX0 = hallCX - hw / 2;
    var hallX1 = hallCX + hw / 2;

    /* 可走区域（内部净空） */
    var stairA = rect(0, 0, sw, sd);
    var stairB = rect(L - sw, 0, sw, sd);
    var corridor = rect(sw + t, 0, L - 2 * (sw + t), cw);
    var hall = rect(hallX0, -hd, hw, hd);

    /* 楼梯门洞：在楼梯间朝向走廊的那面墙上 */
    var stairDoorY0 = cw / 2 - dw / 2;
    var stairDoorY1 = stairDoorY0 + dw;

    var walls = [];
    function W(x, y, w, h) { walls.push(rect(x, y, w, h)); }

    /* —— 楼梯间 A —— */
    W(-t, -t, t, sd + 2 * t);                            // 西外墙
    W(-t, sd, sw + t, t);                                // 南外墙
    W(sw, 0, t, stairDoorY0);                            // 东墙 上段
    W(sw, stairDoorY1, t, sd - stairDoorY1 + t);         // 东墙 下段
    /* —— 楼梯间 B（镜像） —— */
    W(L, -t, t, sd + 2 * t);
    W(L - sw, sd, sw + t, t);
    W(L - sw - t, 0, t, stairDoorY0);
    W(L - sw - t, stairDoorY1, t, sd - stairDoorY1 + t);

    /* —— 走廊 —— */
    W(sw, cw, L - 2 * sw, t);                            // 走廊南墙
    W(sw, -t, hallX0 - sw, t);                           // 走廊北墙（左段）
    W(hallX1, -t, L - sw - hallX1, t);                    // 走廊北墙（右段）

    /* —— 电梯厅凹进 —— */
    W(hallX0 - t, -hd - t, t, hd + t);                   // 西
    W(hallX1, -hd - t, t, hd + t);                        // 东
    var doorW = 1.1;
    var cCX = hallCX - (doorW / 2 + 0.55);               // C 门中心
    var dCX = hallCX + (doorW / 2 + 0.55);               // D 门中心
    var gapC = rect(cCX - doorW / 2, -hd - t, doorW, t);
    var gapD = rect(dCX - doorW / 2, -hd - t, doorW, t);
    W(hallX0 - t, -hd - t, gapC.x - (hallX0 - t), t);     // 北墙 左段
    W(gapC.x + doorW, -hd - t, gapD.x - (gapC.x + doorW), t); // 中段（柱子）
    W(gapD.x + doorW, -hd - t, (hallX1 + t) - (gapD.x + doorW), t); // 右段

    /* —— 轿厢（停在 -hd-t 以北；只有门开着且车在本层才进入） —— */
    var carC = rect(cCX - carW / 2, -hd - t - carD, carW, carD);
    var carD2 = rect(dCX - carW / 2, -hd - t - carD, carW, carD);

    /* —— 楼梯段（人在这个矩形里才能上下楼） —— */
    var stepW = 2.2;
    var stairZoneA = rect((sw - stepW) / 2, 3.3, stepW, sd - 4.0);
    var stairZoneB = rect(L - sw + (sw - stepW) / 2, 3.3, stepW, sd - 4.0);

    /* 呼梯按钮：门旁墙上，左右各一个 */
    var callC = { x: cCX - doorW / 2 - 0.28, y: -hd - t * 0.5 };
    var callD = { x: dCX + doorW / 2 + 0.28, y: -hd - t * 0.5 };

    /* 手电以外的微弱环境光位置（走廊吊灯），带闪烁相位 */
    var lamps = [
      { x: sw + 1.9, y: cw / 2, r: 2.6, warm: true, phase: 0.0 },
      { x: hallCX, y: -hd / 2, r: 3.1, warm: true, phase: 1.7 },
      { x: L - sw - 1.9, y: cw / 2, r: 2.6, warm: false, phase: 3.1 }
    ];

    G = {
      cfg: cfg,
      L: L,
      minX: -t, maxX: L + t,
      minY: -hd - t - carD, maxY: sd + t,
      width: L + 2 * t,
      height: sd + t + hd + t + carD,
      /* 楼层视图（不含轿厢井道） */
      viewMinY: -hd - t - 0.15,
      viewHeight: sd + t - (-hd - t - 0.15),
      t: t,
      corridor: corridor,
      hall: hall,
      hallX0: hallX0, hallX1: hallX1, hallCX: hallCX, hallY0: -hd,
      stairA: stairA, stairB: stairB,
      stairZoneA: stairZoneA, stairZoneB: stairZoneB,
      stairDoorA: { x: sw + t / 2, y0: stairDoorY0, y1: stairDoorY1, hingeY: stairDoorY0, side: 1,
        rect: rect(sw, stairDoorY0, t, dw) },
      stairDoorB: { x: L - sw - t / 2, y0: stairDoorY0, y1: stairDoorY1, hingeY: stairDoorY0, side: -1,
        rect: rect(L - sw - t, stairDoorY0, t, dw) },
      /* 门洞里那一小块也算可走，否则人过不去 */
      connectors: [rect(sw, stairDoorY0, t, dw), rect(L - sw - t, stairDoorY0, t, dw),
        rect(gapC.x, gapC.y, doorW, t), rect(gapD.x, gapD.y, doorW, t)],
      walk: [corridor, hall, stairA, stairB],
      walls: walls,
      elev: {
        C: {
          gap: gapC, car: carC, cx: cCX, doorW: doorW,
          panel: rect(cCX - doorW / 2 - 0.72, -hd + 0.06, 0.46, 0.30)
        },
        D: {
          gap: gapD, car: carD2, cx: dCX, doorW: doorW,
          panel: rect(dCX + doorW / 2 + 0.26, -hd + 0.06, 0.46, 0.30)
        }
      },
      lamps: lamps,
      /* 楼梯口在走廊上的落点（换层后站这儿） */
      landingA: { x: sw + 0.75, y: cw / 2 },
      landingB: { x: L - sw - 0.75, y: cw / 2 }
    };
    return G;
  }

  /* ---------- 基础几何 ---------- */

  function inRect(r, x, y, pad) {
    pad = pad || 0;
    return x > r.x + pad && x < r.x + r.w - pad && y > r.y + pad && y < r.y + r.h - pad;
  }

  function inAnyRect(list, x, y, pad) {
    for (var i = 0; i < list.length; i++) if (inRect(list[i], x, y, pad)) return true;
    return false;
  }

  /** 圆和矩形是否重叠 */
  function circleRect(cx, cy, r, rc) {
    var nx = Math.max(rc.x, Math.min(cx, rc.x + rc.w));
    var ny = Math.max(rc.y, Math.min(cy, rc.y + rc.h));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  /** 线段与矩形相交（用于视线遮挡） */
  function segRect(x1, y1, x2, y2, rc) {
    if (inRect(rc, x1, y1) || inRect(rc, x2, y2)) return true;
    var x3 = rc.x, y3 = rc.y, x4 = rc.x + rc.w, y4 = rc.y + rc.h;
    return segSeg(x1, y1, x2, y2, x3, y3, x4, y3) ||
      segSeg(x1, y1, x2, y2, x4, y3, x4, y4) ||
      segSeg(x1, y1, x2, y2, x4, y4, x3, y4) ||
      segSeg(x1, y1, x2, y2, x3, y4, x3, y3);
  }

  function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    function cross(ox, oy, px, py, qx, qy) {
      return (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
    }
    var d1 = cross(cx, cy, dx, dy, ax, ay);
    var d2 = cross(cx, cy, dx, dy, bx, by);
    var d3 = cross(ax, ay, bx, by, cx, cy);
    var d4 = cross(ax, ay, bx, by, dx, dy);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** 角度差（归一化到 -PI..PI） */
  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  return {
    build: build,
    rect: rect,
    inRect: inRect,
    inAnyRect: inAnyRect,
    circleRect: circleRect,
    segRect: segRect,
    dist: dist,
    angDiff: angDiff,
    clamp: clamp,
    lerp: lerp,
    get g() { return G; }
  };
})();
