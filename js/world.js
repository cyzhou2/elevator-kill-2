/* ============================================================
 * world.js · 世界状态与规则
 * ------------------------------------------------------------
 * 单位全部是「米 / 秒」。一层楼共用同一套平面（见 geom.js）。
 * 玩家只可能在某层走廊、楼梯间或某部轿厢里；
 * AI 分布在 20 层上，各自独立跑，不渲染但照样结算。
 * ============================================================ */
"use strict";

var World = (function () {
  var Cfg = null;
  var G = null;
  var API = null;   // 对外接口（AI 拿到的是它，不是内部 state）

  var W = {
    time: 0,
    running: false,
    over: false,
    reason: null,

    floor: 1,           // 玩家所在层
    viewFloor: 1,       // 正在渲染的楼层
    elevators: [],      // 2 部
    fuses: [],           // 配电箱 [{floor,x,y,done,prog}]
    power: [],           // power[floor] = 该层已通电
    lives: 2,            // 玩家剩余次数
    repair: null,        // { index, t } 正在修的配电箱
    escaped: false,
    hallUp: [],          // hallUp[floor]   = true 表示有人在等上楼
    hallDown: [],        // hallDown[floor] = true 表示有人在等下楼
    stairDoors: [],     // stairDoors[floor] = { A:{...}, B:{...} }
    actors: [],
    player: null,
    noises: [],
    events: [],
    blood: [],          // 每层地上的血迹（{floor,x,y,a}）
    kills: 0,
    score: 0,
    shake: 0,
    flash: 0,           // 白/红闪
    heartbeat: 0,
    tension: 0,         // 0..1 恐怖紧张度，渲染用
    lastSeenKiller: null, // {x,y,t} 给「最后一眼」用
    cam: { x: 0, y: 0 }
  };

  var rand = Math.random;
  function rnd(a, b) { return a + (b - a) * rand(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  /* ================= 初始化 ================= */

  function init(cfg) {
    Cfg = cfg;
    G = Geom.build(cfg);
    if (typeof Nav !== "undefined" && Nav) Nav.build(G);

    W.time = 0; W.running = false; W.over = false; W.reason = null;
    W.actors = []; W.noises = []; W.events = []; W.blood = [];
    W.kills = 0; W.score = 0; W.shake = 0; W.flash = 0;
    W.tension = 0; W.heartbeat = 0; W.lastSeenKiller = null;

    W.hallUp = []; W.hallDown = []; W.stairDoors = [];
    W.threat = 1; W.fuses = []; W.power = []; W.repair = null; W.lives = (cfg.PLAYER && cfg.PLAYER.lives) || 2; W.escaped = false;
    for (var pf0 = 0; pf0 <= cfg.FLOORS; pf0++) W.power[pf0] = false;
    for (var f = 0; f <= cfg.FLOORS; f++) {
      W.hallUp[f] = false;
      W.hallDown[f] = false;
      W.stairDoors[f] = {
        A: makeDoor("A", f), B: makeDoor("B", f)
      };
    }

    W.elevators = [
      { id: "C", floor: 1, dir: 0, state: "idle", timer: 0, calls: new Set(), doorsOpen: false, openAmt: 0, cx: G.elev.C.cx, car: G.elev.C.car, tag: "C" },
      { id: "D", floor: cfg.FLOORS, dir: 0, state: "idle", timer: 0, calls: new Set(), doorsOpen: false, openAmt: 0, cx: G.elev.D.cx, car: G.elev.D.car, tag: "D" }
    ];

    /* —— 玩家：一个小孩（随机楼层，不再永远 1F） —— */
    var sp = cfg.SPAWN || {};
    var pf = cfg.START_FLOOR;
    if (sp.random !== false) {
      var lo = Math.max(2, sp.minFloor || 2);
      var hi = Math.min(cfg.FLOORS - 1, sp.maxFloor || cfg.FLOORS - 1);
      if (hi < lo) { lo = 1; hi = cfg.FLOORS; }
      pf = lo + Math.floor(rand() * (hi - lo + 1));
    }
    var px0 = rnd(G.corridor.x + 1.2, G.corridor.x + G.corridor.w - 1.2);
    var p = spawnKid(0, pf, px0, G.corridor.y + G.corridor.h / 2);
    p.controlled = true;
    W.player = p;
    W.actors.push(p);

    /* —— 其余小孩：随机楼层 —— */
    for (var i = 1; i < cfg.KIDS; i++) {
      var fk = 1 + Math.floor(rand() * cfg.FLOORS);
      if (fk === p.floor) fk = fk >= cfg.FLOORS ? 1 : fk + 1;
      W.actors.push(spawnKid(i, fk, rnd(4, G.L - 4), rnd(0.7, G.corridor.h - 0.7)));
    }

    /* —— 杀人犯：撒在楼上 —— */
    var taken = [p.floor];
    for (var k = 0; k < cfg.KILLERS; k++) {
      /* 离玩家至少 4 层，两个杀人犯也别叠在一起 */
      var pool = [];
      for (var fq2 = 1; fq2 <= cfg.FLOORS; fq2++) {
        if (Math.abs(fq2 - p.floor) < 4) continue;
        if (taken.indexOf(fq2) >= 0) continue;
        pool.push(fq2);
      }
      var fq = pool.length ? pool[Math.floor(rand() * pool.length)] : clamp(cfg.FLOORS - k * 4, 1, cfg.FLOORS);
      taken.push(fq);
      var kk = spawnKiller(k, fq, rnd(4, G.L - 4), rnd(0.7, G.corridor.h - 0.7));
      W.actors.push(kk);
    }

    /* —— 配电箱：随机楼层 + 墙上位置 —— */
    buildFuses(cfg, G);

    W.floor = p.floor;
    W.viewFloor = p.floor;
    addEvent("开局：" + cfg.KIDS + " 个小孩 / " + cfg.KILLERS + " 个杀人犯 / " + cfg.FLOORS + " 层", "sys", null);
    return API;
  }

  function makeDoor(landing, floor) {
    return { landing: landing, floor: floor, open: false, amt: 0, closing: false };
  }

  function spawnKid(i, floor, x, y) {
    return {
      id: "kid" + i, kind: "kid", name: "小孩" + (i + 1),
      floor: floor, x: x, y: y, space: "floor", carId: null,
      face: rnd(0, 6.28), speed: 0, alive: true,
      stamina: Cfg.KID.stamina, sprinting: false,
      lightOn: true, controlled: false,
      score: 0, caughtAt: 0,
      aiTimer: 0, aiGoal: null, aiState: "wander", goalFloor: null,
      stair: null, path: null, fear: 0
    };
  }

  function spawnKiller(i, floor, x, y) {
    return {
      id: "killer" + i, kind: "killer", name: "杀人犯" + (i + 1),
      floor: floor, x: x, y: y, space: "floor", carId: null,
      face: rnd(0, 6.28), alive: true,
      state: "patrol", target: null, lastSeen: null, heard: null,
      aiTimer: rnd(0, 0.4), stair: null, carGoal: null,
      checked: {}, patrolFloor: floor, patrolDir: rand() < 0.5 ? 1 : -1,
      catching: null
    };
  }

  /* ================= 查询 ================= */

  function elevAt(floor) {
    var out = [];
    for (var i = 0; i < W.elevators.length; i++) {
      var e = W.elevators[i];
      if (Math.abs(e.floor - floor) < 0.06) out.push(e);
    }
    return out;
  }

  function carById(id) {
    for (var i = 0; i < W.elevators.length; i++) if (W.elevators[i].id === id) return W.elevators[i];
    return null;
  }

  /** 某层某部电梯门是不是开着可以进出 */
  function carOpenAt(e, floor) {
    return e && e.doorsOpen && Math.abs(e.floor - floor) < 0.06;
  }

  function doorRect(floor, landing) {
    return landing === "A" ? G.stairDoorA.rect : G.stairDoorB.rect;
  }

  function doorOpenAmt(floor, landing) {
    var d = W.stairDoors[floor] && W.stairDoors[floor][landing];
    return d ? d.amt : 0;
  }

  /* ================= 碰撞 / 视线 ================= */

  function wallsAt(floor) {
    var list = G.walls.slice();
    /* 关着的楼梯间门 */
    var dA = W.stairDoors[floor].A, dB = W.stairDoors[floor].B;
    if (dA.amt < 0.55) list.push(G.stairDoorA.rect);
    if (dB.amt < 0.55) list.push(G.stairDoorB.rect);
    /* 关着的电梯门 */
    for (var i = 0; i < W.elevators.length; i++) {
      var e = W.elevators[i];
      var gap = e.id === "C" ? G.elev.C.gap : G.elev.D.gap;
      var near = Math.abs(e.floor - floor) < 0.06;
      var openHere = near && e.openAmt > 0.55;
      if (!openHere) list.push(gap);
    }
    return list;
  }

  function inCarRect(carId, x, y, pad) {
    var r = carId === "C" ? G.elev.C.car : G.elev.D.car;
    return Geom.inRect(r, x, y, pad || 0);
  }

  /** 这个点能不能站（圆半径 r） */
  function canStand(floor, x, y, r) {
    var ok = false;
    for (var i = 0; i < G.walk.length; i++) if (Geom.inRect(G.walk[i], x, y, -0.002)) { ok = true; break; }
    if (!ok) {
      for (var j = 0; j < G.connectors.length; j++) if (Geom.inRect(G.connectors[j], x, y, -0.002)) { ok = true; break; }
    }
    if (!ok) {
      for (var m = 0; m < W.elevators.length; m++) {
        var em = W.elevators[m];
        if (!carOpenAt(em, floor)) continue;
        if (inCarRect(em.id, x, y, -r * 0.4)) { ok = true; break; }
      }
    }
    if (!ok) return false;
    var walls = wallsAt(floor);
    for (var k = 0; k < walls.length; k++) if (Geom.circleRect(x, y, r, walls[k])) return false;
    return true;
  }

  /** 视线：墙体是否挡住（不做视野锥，只做遮挡） */
  function los(floor, x1, y1, x2, y2) {
    var walls = wallsAt(floor);
    for (var i = 0; i < walls.length; i++) {
      if (Geom.segRect(x1, y1, x2, y2, walls[i])) return false;
    }
    return true;
  }

  /* ================= 事件 / 噪声 ================= */

  /* ================= 目标：修配电箱 → 回大厅逃生 ================= */

  var FUSE_SPOTS = [
    { x: 4.0, y: 0.62 }, { x: 6.2, y: 0.62 }, { x: 8.4, y: 0.62 },
    { x: 10.6, y: 0.62 }, { x: 12.8, y: 0.62 }, { x: 15.0, y: 0.62 },
    { x: 4.0, y: 2.28 }, { x: 12.8, y: 2.28 }
  ];

  function buildFuses(cfg, geom) {
    var n = (cfg.OBJ && cfg.OBJ.fuses) || 3;
    var pool = [];
    for (var f = 2; f <= cfg.FLOORS; f++) pool.push(f);
    /* 洗牌 */
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    for (var k = 0; k < n && k < pool.length; k++) {
      var fl = pool[k];
      var spot = FUSE_SPOTS[Math.floor(rand() * FUSE_SPOTS.length)];
      W.fuses.push({ floor: fl, x: spot.x, y: spot.y, done: false, prog: 0 });
    }
    W.fuses.sort(function (a, b) { return a.floor - b.floor; });
  }

  function fuseOnFloor(f) {
    for (var i = 0; i < W.fuses.length; i++) if (W.fuses[i].floor === f) return W.fuses[i];
    return null;
  }

  function fusesDone() {
    var n = 0;
    for (var i = 0; i < W.fuses.length; i++) if (W.fuses[i].done) n++;
    return n;
  }

  function allFusesDone() { return W.fuses.length > 0 && fusesDone() === W.fuses.length; }

  /** 玩家跟前有没有能修的配电箱 */
  function nearFuse() {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return null;
    for (var i = 0; i < W.fuses.length; i++) {
      var f = W.fuses[i];
      if (f.done || f.floor !== p.floor) continue;
      if (dist(p.x, p.y, f.x, f.y) <= ((Cfg.OBJ && Cfg.OBJ.touchDist) || 1.0)) return f;
    }
    return null;
  }

  /** 1F 大厅的紧急逃生按钮 */
  function nearExit() {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor" || p.floor !== 1) return false;
    var ex = G.hallCX - 1.6, ey = G.hallY0 + 0.55;
    return dist(p.x, p.y, ex, ey) < 1.1;
  }

  /** 每帧推进修理 */
  function updateRepair(dt) {
    var O = Cfg.OBJ || {};
    var p = W.player;
    var f = W.repair ? W.fuses[W.repair.index] : null;
    if (!W.repair || !f || f.done || !p || !p.alive || p.space !== "floor" || p.floor !== f.floor) {
      W.repair = null;
      return;
    }
    if (dist(p.x, p.y, f.x, f.y) > (O.breakDist || 1.5)) { W.repair = null; return; }

    W.repair.t += dt;
    W.repair.noiseT = (W.repair.noiseT || 0) + dt;
    if (W.repair.noiseT >= (O.noiseEvery || 0.8)) {
      W.repair.noiseT = 0;
      emitNoise(f.floor, f.x, f.y, O.noiseRadius || 12, "repair");
      if (window.Audio2) Audio2.repair(true);
    }

    f.prog = Math.min(1, W.repair.t / (O.repairSec || 6));
    if (f.prog >= 1) {
      f.done = true;
      W.repair = null;
      W.power[f.floor] = true;
      W.flash = 0.55;
      if (window.Audio2) Audio2.powerOn();
      addEvent("你修好了 " + f.floor + "F 的配电箱（" + fusesDone() + "/" + W.fuses.length + "）", "obj", f.floor);
      emitNoise(f.floor, f.x, f.y, 8, "power");
      if (allFusesDone()) {
        addEvent("全部恢复供电 —— 回 1F 大厅按紧急按钮离开", "obj", null);
        if (window.Audio2) Audio2.ding(0.9);
      }
    }
  }

  /** 玩家按"用"：修配电箱 / 按紧急按钮 */
  function playerUse() {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return false;
    if (allFusesDone() && nearExit()) {
      W.escaped = true;
      endRound("escape");
      return true;
    }
    var f = nearFuse();
    if (f) {
      if (!W.repair || W.repair.index !== W.fuses.indexOf(f)) {
        W.repair = { index: W.fuses.indexOf(f), t: f.prog * ((Cfg.OBJ && Cfg.OBJ.repairSec) || 6), noiseT: 0 };
        if (window.Audio2) Audio2.repair(true);
      }
      return true;
    }
    return false;
  }

  function addEvent(text, kind, floor) {
    W.events.push({ t: W.time, text: text, kind: kind || "sys", floor: floor == null ? null : floor });
    if (W.events.length > 300) W.events.shift();
  }

  function emitNoise(floor, x, y, radius, kind) {
    W.noises.push({ floor: floor, x: x, y: y, r: radius, kind: kind, t: W.time });
    for (var i = 0; i < W.actors.length; i++) {
      var a = W.actors[i];
      if (a.kind !== "killer" || !a.alive) continue;

      /* 修理/通电是"结构噪音"：会顺着管井传到上下两层（有一定概率），
         传过去的位置是模糊的 —— 它只知道"那层有人在动"，不知道具体哪个门牌 */
      if (kind === "repair" || kind === "power") {
        var gapF = Math.abs(a.floor - floor);
        if (gapF > 0 && gapF <= 2 && Math.random() < 0.5) {
          a.heard = {
            x: x + rnd(-2.2, 2.2), y: clamp(y + rnd(-1.2, 1.2), 0.6, G.corridor.h - 0.5),
            floor: floor, t: W.time, kind: "muffled"
          };
          continue;
        }
      }

      if (a.floor !== floor) continue;
      if (dist(a.x, a.y, x, y) <= radius) {
        a.heard = { x: x, y: y, floor: floor, t: W.time, kind: kind };
      }
    }
  }

  /* ================= 玩家动作 ================= */

  function moveActor(a, dx, dy, dt) {
    if (!dx && !dy) return;
    var r = a.kind === "kid" ? Cfg.KID.radius : Cfg.KILLER.radius;
    var nx = a.x + dx, ny = a.y + dy;

    if (a.space === "car") {
      var cr = a.carId === "C" ? G.elev.C.car : G.elev.D.car;
      a.x = clamp(nx, cr.x + r, cr.x + cr.w - r);
      a.y = clamp(ny, cr.y + r, cr.y + cr.h - r);
      return;
    }

    /* 撞墙时按比例退让，别整个人卡在离墙 1 厘米的地方动不了 */
    var FR = [1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.08];
    for (var fi = 0; fi < FR.length; fi++) {
      var cx2 = a.x + dx * FR[fi];
      if (canStand(a.floor, cx2, a.y, r)) { a.x = cx2; break; }
    }
    for (var fj = 0; fj < FR.length; fj++) {
      var cy2 = a.y + dy * FR[fj];
      if (canStand(a.floor, a.x, cy2, r)) { a.y = cy2; break; }
    }

    /* 走进电梯井 = 进轿厢 */
    for (var i = 0; i < W.elevators.length; i++) {
      var e = W.elevators[i];
      if (!carOpenAt(e, a.floor)) continue;
      if (inCarRect(e.id, a.x, a.y, -r * 0.35)) {
        boardCar(a, e);
        return;
      }
    }
  }

  function boardCar(a, e) {
    a.space = "car";
    a.carId = e.id;
    var cr = e.id === "C" ? G.elev.C.car : G.elev.D.car;
    a.floor = Math.round(e.floor);
    a.x = clamp(a.x, cr.x + 0.3, cr.x + cr.w - 0.3);
    a.y = clamp(a.y, cr.y + 0.3, cr.y + cr.h - 0.3);
    if (a.controlled) addEvent("你进了 " + e.id + " 梯（" + Math.round(e.floor) + "F）", "you", a.floor);
  }

  function exitCarToHall(a) {
    var e = carById(a.carId);
    if (!e) return;
    var fl = Math.round(e.floor);
    a.space = "floor";
    a.floor = fl;
    a.x = e.cx;
    a.y = G.hallY0 + 0.36;
    a.carId = null;
    if (a.controlled) addEvent("你出了电梯（" + fl + "F）", "you", fl);
  }

  /** 楼梯：A(n) ↔ B(n±1)，和一代一致 */
  function otherLanding(landing) { return landing === "A" ? "B" : "A"; }

  function startStairs(a, landing, dir) {
    var nf = a.floor + dir;
    if (nf < 1 || nf > Cfg.FLOORS) return false;
    a.space = "stair";
    a.stair = { from: a.floor, to: nf, fromLanding: landing, toLanding: otherLanding(landing), dir: dir, t: 0, dur: Cfg.STAIR.traverseSec };
    a.x = landing === "A" ? G.stairZoneA.x + G.stairZoneA.w / 2 : G.stairZoneB.x + G.stairZoneB.w / 2;
    a.y = G.stairZoneA.y + 0.4;
    emitNoise(a.floor, a.x, a.y, 4.5, "stair");
    if (a.controlled) addEvent("你从楼梯" + (dir > 0 ? "上" : "下") + "到 " + nf + "F", "you", nf);
    return true;
  }

  function finishStairs(a) {
    var s = a.stair;
    a.floor = s.to;
    a.space = "floor";
    a.stair = null;
    var zone = s.toLanding === "A" ? G.stairZoneA : G.stairZoneB;
    a.x = zone.x + zone.w / 2;
    a.y = zone.y + 0.5;
    /* 到站把楼梯门带上 */
    var d = W.stairDoors[a.floor][s.toLanding];
    d.open = false;
    if (a.kind === "kid" && a.controlled) W.floor = a.floor;
  }

  /* ================= 电梯 ================= */

  /** 这部梯在这一层要不要停（dir>0 只看上行呼梯，dir<0 只看下行，0 = 都看） */
  function hasCall(e, f, dir) {
    if (e.calls.has(f)) return true;
    if (dir > 0) return !!W.hallUp[f];
    if (dir < 0) return !!W.hallDown[f];
    return !!(W.hallUp[f] || W.hallDown[f]);
  }

  function anyCall(e) {
    if (e.calls.size) return true;
    for (var f = 1; f <= Cfg.FLOORS; f++) if (W.hallUp[f] || W.hallDown[f]) return true;
    return false;
  }

  function stopsAhead(e, dir) {
    var out = [];
    for (var f = 1; f <= Cfg.FLOORS; f++) {
      var ahead = dir > 0 ? f > e.floor + 0.06 : f < e.floor - 0.06;
      if (ahead && hasCall(e, f, dir)) out.push(f);
    }
    return out;
  }

  function nearestCall(e) {
    var best = null, bd = 1e9;
    for (var f = 1; f <= Cfg.FLOORS; f++) {
      if (!e.calls.has(f) && !W.hallUp[f] && !W.hallDown[f]) continue;
      var d = Math.abs(f - e.floor);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function clearFloorCalls(e, f, dir) {
    e.calls.delete(f);
    if (dir > 0) W.hallUp[f] = false;
    else if (dir < 0) W.hallDown[f] = false;
    else { W.hallUp[f] = false; W.hallDown[f] = false; }
  }

  function openDoors(e, f, dir) {
    var d = dir === undefined ? e.dir : dir;
    e.floor = f;
    e.state = "opening";
    e.timer = Cfg.ELEV.doorOpenSec;
    e.doorsOpen = false;
    e.openedFor = d || 1;
    clearFloorCalls(e, f, d);
    /* 反方向这层还亮着 → 关门后补开一次（一代的「补开门」） */
    if (d > 0) e.mustReopen = !!W.hallDown[f];
    else if (d < 0) e.mustReopen = !!W.hallUp[f];
    else e.mustReopen = false;
    emitNoise(f, e.cx, G.hallY0 + 0.5, 4.0, "elev");
  }
  function dir2(e) { return e.dir || 1; }

  /** 停靠判定：轿厢选层，或同方向呼梯；dir=0 时任何呼梯都算 */
  function wantsStopAt(e, f, dir) {
    if (e.calls.has(f)) return true;
    if (dir > 0) return !!W.hallUp[f];
    if (dir < 0) return !!W.hallDown[f];
    return !!(W.hallUp[f] || W.hallDown[f]);
  }

  /** 当前方向上、从本层（含）起还要停的层，按行进顺序排好 —— 事件队列 */
  function queueFor(e, dir) {
    if (!dir) return [];
    var list = [];
    for (var f = 1; f <= Cfg.FLOORS; f++) {
      if (dir > 0 ? f < e.floor - 0.05 : f > e.floor + 0.05) continue;
      if (wantsStopAt(e, f, dir)) list.push(f);
    }
    list.sort(function (a, b) { return dir > 0 ? a - b : b - a; });
    return list;
  }

  /**
   * 只决定「下一步干什么」，不负责移动。
   * 顺序和一代一致：本层该停→开门；正方向有活→继续；反方向有活→整层掉头；
   * 两边都空但还有没响应的呼梯→朝最近那层出发；真没有→待机（不在整层就先靠层）。
   */
  function planElevator(e) {
    var at = Math.round(e.floor);
    var onInt = Math.abs(e.floor - at) < 0.02;

    /* 1) 就在本层且该停 */
    if (onInt && wantsStopAt(e, at, e.dir)) { e.floor = at; openDoors(e, at, e.dir); return; }

    /* 2) 正方向还有活 → 方向不变继续跑（延长线上冒出新任务会自动续上） */
    if (e.dir !== 0 && queueFor(e, e.dir).length) { e.state = "moving"; e.settleDir = e.dir; return; }

    /* 3) 正方向空了、反方向有活 → 只在整层掉头 */
    if (e.dir !== 0 && queueFor(e, -e.dir).length) {
      if (onInt) {
        e.floor = at;
        e.dir = -e.dir;
        e.settleDir = e.dir;
        e.state = "moving";
      } else {
        e.state = "moving";
      }
      return;
    }

    /* 4) 两个方向都空，但还有没人响应的呼梯 → 立刻朝最近那层出发 */
    var n = nearestCall(e);
    if (n != null) {
      if (Math.abs(n - e.floor) < 0.06) { openDoors(e, n, e.dir); return; }
      e.dir = n > e.floor ? 1 : -1;
      e.settleDir = e.dir;
      e.state = "moving";
      return;
    }

    /* 5) 真没任务：整层待机；不在整层就沿原方向靠到最近整层 */
    if (onInt) {
      e.floor = at;
      e.dir = 0;
      e.state = "idle";
    } else {
      e.dir = e.settleDir || (e.floor - Math.floor(e.floor) >= 0.5 ? 1 : -1);
      e.state = "moving";
    }
  }

  /** 逐层推进：每跨过一层就问一次要不要停 */
  function elevatorMove(e, dt) {
    var remain = (1 / Cfg.ELEV.secPerFloor) * dt;
    var guard = 0;
    while (remain > 1e-9 && guard++ < 64) {
      if (e.dir === 0) break;
      var nextInt = e.dir > 0
        ? Math.floor(e.floor + 1e-9) + 1
        : Math.ceil(e.floor - 1e-9) - 1;

      /* 到端点 */
      if (nextInt < 1 || nextInt > Cfg.FLOORS) {
        e.floor = e.dir > 0 ? Cfg.FLOORS : 1;
        e.dir = -e.dir;
        if (wantsStopAt(e, e.floor, e.dir)) { openDoors(e, e.floor, e.dir); return; }
        e.dir = 0;
        e.state = "idle";
        return;
      }

      var gap = Math.abs(nextInt - e.floor);
      if (remain >= gap - 1e-9) {
        remain -= gap;
        e.floor = nextInt;
        /* 到了整层：该停就停，绝不开过去 */
        if (wantsStopAt(e, nextInt, e.dir)) { openDoors(e, nextInt, e.dir); return; }
      } else {
        e.floor += e.dir * remain;
        remain = 0;
      }
    }
  }

  function updateElevator(e, dt) {
    switch (e.state) {
      case "opening":
        e.timer -= dt;
        e.openAmt = Math.min(1, e.openAmt + dt / Cfg.ELEV.doorOpenSec);
        if (e.timer <= 0) { e.state = "open"; e.doorsOpen = true; e.openAmt = 1; e.timer = Cfg.ELEV.doorHoldSec; }
        break;

      case "open":
        e.openAmt = 1;
        /* 有人站在门口/大厅里朝电梯走 → 门保持打开 */
        if (W.player && W.player.space === "floor" && W.player.alive &&
            Math.abs(e.floor - Math.round(e.floor)) < 0.06 &&
            Math.abs(W.player.floor - Math.round(e.floor)) < 0.5 &&
            dist(W.player.x, W.player.y, e.cx, G.hallY0 + 0.4) < 2.6) {
          e.timer = Math.max(e.timer, Cfg.ELEV.doorHoldSec * 0.75);
        }
        /* 有人按了"出"但当时门是关的 —— 现在门开了，替他出去 */
        for (var pi = 0; pi < W.actors.length; pi++) {
          var pa = W.actors[pi];
          if (pa.space === "car" && pa.carId === e.id && pa.pendingExit) {
            pa.pendingExit = false;
            exitCarToHall(pa);
          }
        }
        e.timer -= dt;
        if (e.timer <= 0) { e.state = "closing"; e.timer = Cfg.ELEV.doorCloseSec; }
        break;

      case "closing": {
        e.doorsOpen = false;
        e.timer -= dt;
        e.openAmt = Math.max(0, e.openAmt - dt / Cfg.ELEV.doorCloseSec);
        var cf = Math.round(e.floor);
        var atCf = Math.abs(e.floor - cf) < 0.06;
        /* 关门途中这层又被叫了 → 重新开门 */
        if (atCf && wantsStopAt(e, cf, e.dir) && e.openAmt < 0.6) {
          /* 必须走 openDoors：它才会把呼梯消掉，否则会一直开开合合 */
          openDoors(e, cf, e.dir);
          break;
        }
        if (e.timer <= 0) {
          e.openAmt = 0;
          /* 反方向这层还亮着 → 补开一次门，把两个方向都服务掉 */
          if (atCf && e.mustReopen && wantsStopAt(e, cf, -e.dir)) {
            e.mustReopen = false;
            openDoors(e, cf, -e.dir);
            break;
          }
          e.mustReopen = false;
          planElevator(e);
        }
        break;
      }

      default: {
        /* idle / moving：每帧都重算一次（一代就是这么做的） */
        var at = Math.round(e.floor);
        var onInt = Math.abs(e.floor - at) < 0.02;

        /* 压在整层且该停 → 先开门，绝不跳过 */
        if (onInt && e.dir !== 0 && wantsStopAt(e, at, e.dir)) {
          e.floor = at;
          openDoors(e, at, e.dir);
          break;
        }

        /* 待机：有任务就出发；没有就待机（不在整层先靠层） */
        if (e.dir === 0) {
          if (!anyCall(e)) {
            if (onInt) { e.floor = at; e.state = "idle"; break; }
            e.dir = e.settleDir || (e.floor - Math.floor(e.floor) >= 0.5 ? 1 : -1);
            e.state = "moving";
            elevatorMove(e, dt);
            break;
          }
          planElevator(e);
          if (e.state !== "moving" || e.dir === 0) break;
        }

        /* 正方向队列空了 → 整层掉头或待机 */
        if (queueFor(e, e.dir).length === 0) {
          if (onInt) {
            if (queueFor(e, -e.dir).length) {
              e.floor = at;
              e.dir = -e.dir;
              e.settleDir = e.dir;
            } else {
              e.floor = at;
              e.dir = 0;
              e.state = "idle";
              if (anyCall(e)) planElevator(e);
              break;
            }
          }
        }

        e.state = "moving";
        e.settleDir = e.dir;
        elevatorMove(e, dt);
        break;
      }
    }
  }

  /** 走到楼梯门前就顺手推开（寻路全程都用） */
  function autoOpenDoor(a) {
    if (!a || !a.alive || a.space !== "floor") return;
    for (var i = 0; i < 2; i++) {
      var L = i === 0 ? "A" : "B";
      var dr = doorRect(a.floor, L);
      var cx = dr.x + dr.w / 2, cy = dr.y + dr.h / 2;
      if (dist(a.x, a.y, cx, cy) > 1.25) continue;
      var d = W.stairDoors[a.floor][L];
      if (d.open) continue;
      d.open = true;
      d.closeTimer = 0;
      emitNoise(a.floor, cx, cy, Cfg.DOOR.noise, "door");
      if (window.Audio2 && a.controlled) Audio2.door(true);
      if (a.controlled) addEvent("你推开了楼梯间的门", "you", a.floor);
    }
  }

  /** 万一被挤进墙里/角落，把人推回最近的可站立点 */
  function unstick(a) {
    if (a.space !== "floor") return;
    var r = a.kind === "kid" ? Cfg.KID.radius : Cfg.KILLER.radius;
    if (canStand(a.floor, a.x, a.y, r)) return;
    for (var step = 1; step <= 24; step++) {
      var d = step * 0.1;
      for (var k = 0; k < 12; k++) {
        var ang = (k / 12) * Math.PI * 2;
        var nx = a.x + Math.cos(ang) * d, ny = a.y + Math.sin(ang) * d;
        if (canStand(a.floor, nx, ny, r)) { a.x = nx; a.y = ny; return; }
      }
    }
  }

  /* ================= 主更新 ================= */

  function update(dt) {
    if (W.over) return;
    W.time += dt;
    if (W.player) {
      if (W.player.hurtT > 0) W.player.hurtT = Math.max(0, W.player.hurtT - dt);
      if (W.player.invuln > 0) W.player.invuln = Math.max(0, W.player.invuln - dt);
    }
    updateRepair(dt);

    /* 玩家楼层 / 正在渲染的楼层 */
    if (W.player) {
      if (W.player.space === "floor") { W.floor = W.player.floor; W.viewFloor = W.player.floor; }
      else if (W.player.space === "car") {
        var pc = carById(W.player.carId);
        if (pc) { W.floor = Math.round(pc.floor); W.viewFloor = Math.round(pc.floor); }
      } else if (W.player.space === "stair" && W.player.stair) {
        W.viewFloor = W.player.stair.to;
      }
    }

    /* 门：自动关 */
    for (var f = 1; f <= Cfg.FLOORS; f++) {
      for (var i = 0; i < 2; i++) {
        var L = i === 0 ? "A" : "B";
        var d = W.stairDoors[f][L];
        if (d.open) {
          d.amt = Math.min(1, d.amt + dt / Cfg.DOOR.openSec);
          d.closeTimer = (d.closeTimer || 0) + dt;
          if (d.closeTimer > Cfg.STAIR.doorAutoClose) { d.open = false; d.closeTimer = 0; }
        } else {
          d.amt = Math.max(0, d.amt - dt / Cfg.DOOR.closeSec);
        }
      }
    }

    /* 电梯 */
    for (var e2 = 0; e2 < W.elevators.length; e2++) updateElevator(W.elevators[e2], dt);

    /* 角色 */
    for (var a = 0; a < W.actors.length; a++) {
      var ac = W.actors[a];
      if (!ac.alive) continue;
      if (ac.space === "stair") {
        ac.stair.t += dt;
        if (ac.stair.t >= ac.stair.dur) finishStairs(ac);
        continue;
      }
      if (ac.controlled) continue;                    // 玩家由 input 驱动
      unstick(ac);
      if (ac.kind === "kid") AI.kidUpdate(API, ac, dt);
      else AI.killerUpdate(API, ac, dt);
    }

    /* 抓到判定 */
    for (var k = 0; k < W.actors.length; k++) {
      var ki = W.actors[k];
      if (ki.kind !== "killer" || !ki.alive) continue;
      ki.catching = null;
      for (var q = 0; q < W.actors.length; q++) {
        var kd = W.actors[q];
        if (kd.kind !== "kid" || !kd.alive) continue;
        if (kd.space === "stair" || ki.space === "stair") continue;
        if (kd.floor !== ki.floor) continue;
        if (kd.space !== ki.space) continue;
        if (kd.space === "car" && kd.carId !== ki.carId) continue;
        if (dist(kd.x, kd.y, ki.x, ki.y) <= Cfg.KILLER.catchRange) {
          ki.catching = kd;
        }
      }
    }
    /* 读条：被按住就累加，脱手就清零 */
    for (var g1 = 0; g1 < W.actors.length; g1++) {
      var gk = W.actors[g1];
      if (gk.kind === "kid") gk.heldBy = null;
    }
    for (var k2 = 0; k2 < W.actors.length; k2++) {
      var kk = W.actors[k2];
      if (kk.kind !== "killer" || !kk.catching) continue;
      kk.catching.heldBy = kk;
    }
    for (var k3 = 0; k3 < W.actors.length; k3++) {
      var kid = W.actors[k3];
      if (kid.kind !== "kid" || !kid.alive) continue;
      if (kid.heldBy) {
        kid.grip = (kid.grip || 0) + dt;
        if (kid.grip >= Cfg.KILLER.catchTime) catchKid(kid, kid.heldBy);
      } else {
        kid.grip = 0;
      }
    }

    /* 紧张度 & 心跳 */
    updateTension(dt);

    /* 威胁值：修得越多、拖得越久，它越快 */
    var TH = Cfg.THREAT || { base: 1, perFuse: 0.06, perMinute: 0.03, max: 1.45 };
    W.threat = Math.min(TH.max, TH.base + fusesDone() * TH.perFuse + (W.time / 60) * TH.perMinute);

    /* 硬性时限（默认关闭） */
    if (Cfg.ROUND_SEC > 0 && W.time >= Cfg.ROUND_SEC) endRound("time");
  }

  function updateTension(dt) {
    var p = W.player;
    var near = 99, seenK = null;
    if (p && p.alive) {
      for (var i = 0; i < W.actors.length; i++) {
        var a = W.actors[i];
        if (a.kind !== "killer" || !a.alive) continue;
        if (a.floor !== p.floor) continue;
        var d = (p.space === "car" && a.space !== "car") ? 99 : dist(a.x, a.y, p.x, p.y);
        if (d < near) { near = d; seenK = a; }
      }
    }
    var target = near < Cfg.TENSION.heartRadius ? 1 - near / Cfg.TENSION.heartRadius : 0;
    W.tension += (target - W.tension) * Math.min(1, dt * 2.2);
    W.shake = Math.max(0, W.shake - dt * 2.5);
    W.flash = Math.max(0, W.flash - dt * 2.2);

    if (near < 1e9 && near < 12 && seenK) {
      W.lastSeenKiller = { x: seenK.x, y: seenK.y, t: W.time };
    }
  }

  function catchKid(kid, killer) {
    /* 玩家有两条命：第一次被抓只是受伤，被打退、短暂无敌，杀人犯会被甩开 */
    if (kid.controlled && W.lives > 1) {
      W.lives--;
      kid.hurtT = (Cfg.PLAYER && Cfg.PLAYER.hurtSec) || 12;
      kid.invuln = (Cfg.PLAYER && Cfg.PLAYER.invulnSec) || 3;
      kid.grip = 0;
      W.shake = 1;
      W.flash = 0.8;
      W.blood.push({ floor: kid.floor, x: kid.x, y: kid.y, r: 0.5, a: 0.4 });
      if (W.repair) W.repair = null;
      addEvent("你被 " + killer.name + " 抓住了！剩 " + W.lives + " 条命", "hurt", kid.floor);
      emitNoise(kid.floor, kid.x, kid.y, 9, "scream");
      /* 杀人犯被甩开：转身走开几秒 */
      killer.state = "patrol";
      killer.catching = null;
      killer.aiTimer = 3.5;
      killer.target = null;
      killer.chaseKid = null;
      killer.path = null;
      killer.chaseCool = W.time + 4;
      if (window.Audio2) Audio2.hurt();
      return;
    }
    kid.alive = false;
    kid.caughtAt = W.time;
    kid.grip = 0;
    W.kills++;
    W.shake = 1;
    W.flash = 1;
    W.blood.push({ floor: kid.floor, x: kid.x, y: kid.y, r: rnd(0.35, 0.7), a: 0.5 });
    if (W.blood.length > 40) W.blood.shift();
    addEvent(killer.name + " 抓住了 " + kid.name + (kid.controlled ? "（你）" : ""), "kill", kid.floor);
    emitNoise(kid.floor, kid.x, kid.y, 10, "scream");
    killer.state = "patrol";
    killer.catching = null;
    if (kid.controlled) endRound("caught");
    else if (countAliveKids() === 0) endRound("allcaught");
  }

  function countAliveKids() {
    var n = 0;
    for (var i = 0; i < W.actors.length; i++) if (W.actors[i].kind === "kid" && W.actors[i].alive) n++;
    return n;
  }
  function countAliveKillers() {
    var n = 0;
    for (var i = 0; i < W.actors.length; i++) if (W.actors[i].kind === "killer" && W.actors[i].alive) n++;
    return n;
  }

  function endRound(reason) {
    if (W.over) return;
    W.over = true;
    W.running = false;
    W.reason = reason;
    if (reason === "escape") {
      W.score = Math.round(1200 + Math.max(0, 600 - W.time) * 3 + fusesDone() * 150);
      addEvent("你按下了紧急按钮 —— 门开了", "obj", 1);
      return;
    }
    var p = W.player;
    if (reason === "time" && p.alive) W.score = Math.round(W.time * Cfg.SCORE.perSecond + Cfg.SCORE.surviveBonus);
    addEvent(reason === "time" ? "时间到" : reason === "caught" ? "你被抓住了" : "全员被抓", "sys", null);
  }

  /* ================= 玩家 API（给 input / ui 用） ================= */

  function playerMoveAxis(dx, dy, sprint, dt) {
    var p = W.player;
    if (!p || !p.alive || p.space === "stair") return;
    var len = Math.hypot(dx, dy);
    if (len > 1e-4) { dx /= len; dy /= len; }
    var canSprint = sprint && p.stamina > 1 && len > 0.1;
    p.sprinting = canSprint;
    var sp = canSprint ? Cfg.KID.sprint : Cfg.KID.speed;
    /* 受伤时慢一点 */
    var hurtMoveMul = (p.hurtT > 0 && Cfg.PLAYER) ? Cfg.PLAYER.hurtSpeed : 1;
    sp *= hurtMoveMul;
    if (canSprint) p.stamina = Math.max(0, p.stamina - Cfg.KID.staminaDrain * dt);
    else p.stamina = Math.min(Cfg.KID.stamina, p.stamina + Cfg.KID.staminaRegen * dt);

    if (len > 0.1) p.face = Math.atan2(dy, dx);
    moveActor(p, dx * sp * dt, dy * sp * dt, dt);
    /* 脚步声（轿厢里几乎是静的） */
    p.stepAcc = (p.stepAcc || 0) + sp * dt;
    var stride = canSprint ? 1.5 : 1.05;
    if (p.stepAcc > stride) {
      p.stepAcc = 0;
      if (p.space === "car") {
        if (window.Audio2) Audio2.footstep(false, true);
      } else {
        emitNoise(p.floor, p.x, p.y, canSprint ? Cfg.KILLER.hearSprint : Cfg.KILLER.hearWalk, canSprint ? "sprint" : "walk");
        if (window.Audio2) Audio2.footstep(canSprint, p.floor === W.viewFloor);
      }
    }
  }

  function playerTryStairs(dir) {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return false;
    var landing = null;
    if (Geom.inRect(G.stairZoneA, p.x, p.y, -0.1)) landing = "A";
    else if (Geom.inRect(G.stairZoneB, p.x, p.y, -0.1)) landing = "B";
    if (!landing) return false;
    return startStairs(p, landing, dir);
  }

  function playerInteract() { /* 兼容占位 */ }

  function playerToggleDoor() {
    var p = W.player;
    if (!p || !p.alive) return;
    /* 最近的楼梯间门 */
    var f = p.floor;
    for (var i = 0; i < 2; i++) {
      var L = i === 0 ? "A" : "B";
      var dr = doorRect(f, L);
      var cx = dr.x + dr.w / 2, cy = dr.y + dr.h / 2;
      if (dist(p.x, p.y, cx, cy) < 1.35) {
        var d = W.stairDoors[f][L];
        d.open = !d.open;
        d.closeTimer = 0;
        emitNoise(f, cx, cy, Cfg.DOOR.noise, "door");
        if (window.Audio2) Audio2.door(d.open);
        if (p.controlled) addEvent(d.open ? "你推开了楼梯间的门" : "你带上了楼梯间的门", "you", f);
        return;
      }
    }
  }

  /** 玩家按呼梯键：dir=1 上、dir=-1 下（1F 不能下、20F 不能上） */
  function playerCallElevator(dir) {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return false;
    if (!panelVisible()) return false;
    var d = dir > 0 ? 1 : dir < 0 ? -1 : 0;
    if (!d) return false;
    if (d > 0 && p.floor >= Cfg.FLOORS) return false;
    if (d < 0 && p.floor <= 1) return false;
    var arr = d > 0 ? W.hallUp : W.hallDown;
    if (arr[p.floor]) return false;
    arr[p.floor] = true;
    if (window.Audio2) Audio2.ding(0.4);
    if (p.controlled) addEvent("你在 " + p.floor + "F 按了 " + (d > 0 ? "▲ 上" : "▼ 下"), "you", p.floor);
    return true;
  }

  function canCall(dir) {
    var p = W.player;
    if (!p || p.space !== "floor") return false;
    if (dir > 0) return p.floor < Cfg.FLOORS;
    if (dir < 0) return p.floor > 1;
    return false;
  }

  /** 呼梯面板只有在电梯附近才显示（也没法用键盘盲按） */
  function panelVisible() {
    var p = W.player;
    if (!p || !p.alive || p.space === "stair") return false;
    if (p.space === "car") return false;
    var G2 = G;
    if (Geom.inRect(G2.hall, p.x, p.y, 0.1)) return true;
    return dist(p.x, p.y, G2.hallCX, G2.hallY0 + 1.2) < 5.2;
  }

  function playerPressCarFloor(floorNum) {
    var p = W.player;
    if (!p || !p.alive || p.space !== "car") return;
    var e = carById(p.carId);
    if (!e) return;
    if (e.calls.has(floorNum)) e.calls.delete(floorNum);
    else e.calls.add(floorNum);
    if (window.Audio2) Audio2.ding(0.25);
    addEvent("你按了 " + e.id + " 梯的 " + floorNum + "F", "you", null);
  }

  function playerToggleCarDoor(open) {
    var p = W.player;
    if (!p || p.space !== "car") return;
    var e = carById(p.carId);
    if (!e) return;
    if (open) {
      if (e.state === "open") { e.timer = Cfg.ELEV.doorHoldSec; }
      else if (e.state === "closing") { e.state = "opening"; e.timer = Cfg.ELEV.doorOpenSec; }
      else if (e.state === "idle" || (e.state === "moving" && e.dir === 0)) openDoors(e, Math.round(e.floor));
    } else {
      if (e.state === "open") { e.state = "closing"; e.timer = Cfg.ELEV.doorCloseSec; }
    }
  }

  function playerExitCar() {
    var p = W.player;
    if (!p || p.space !== "car") return false;
    var e = carById(p.carId);
    if (!e) return false;
    if (!e.doorsOpen) {
      var at = Math.round(e.floor);
      /* 还在跑：记下"到站就出去"，到站开门时自动送你出门 */
      if (Math.abs(e.floor - at) > 0.06) {
        if (!p.pendingExit) {
          p.pendingExit = true;
          if (window.UI) UI.toast("到站会开门，然后自动出去");
          if (p.controlled) addEvent("你要出门 —— 到站后自动开门", "sys", p.floor);
        }
        return true;
      }
      /* 停稳了但门关着：先开门，开门后自动出去 */
      p.pendingExit = true;
      if (e.state !== "opening" && e.state !== "open") openDoors(e, at, e.dir);
      if (window.UI) UI.toast("正在开门…");
      return true;
    }
    p.pendingExit = false;
    exitCarToHall(p);
    W.floor = p.floor;
    return true;
  }

  /** 门开着、站在电梯口 → 按"用"直接进轿厢 */
  function boardOpenCar() {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return false;
    for (var i = 0; i < W.elevators.length; i++) {
      var e = W.elevators[i];
      if (!carOpenAt(e, p.floor)) continue;
      if (dist(p.x, p.y, e.cx, G.hallY0 + 0.35) < 1.5) {
        boardCar(p, e);
        return true;
      }
    }
    return false;
  }

  function nearDoor() {
    var p = W.player;
    if (!p || p.space !== "floor") return null;
    for (var i = 0; i < 2; i++) {
      var L = i === 0 ? "A" : "B";
      var dr = doorRect(p.floor, L);
      if (dist(p.x, p.y, dr.x + dr.w / 2, dr.y + dr.h / 2) < 1.35) return L;
    }
    return null;
  }

  function nearStairs() {
    var p = W.player;
    if (!p || p.space !== "floor") return 0;
    if (Geom.inRect(G.stairZoneA, p.x, p.y, -0.1) || Geom.inRect(G.stairZoneB, p.x, p.y, -0.1)) return 1;
    return 0;
  }

  API = {
    init: init,
    /* 状态字段直接映射到内部 state，外面统一用世界对象即可 */
    get time() { return W.time; },
    get over() { return W.over; },
    get reason() { return W.reason; },
    get player() { return W.player; },
    get actors() { return W.actors; },
    get elevators() { return W.elevators; },
    get tension() { return W.tension; },
    get shake() { return W.shake; },
    get flash() { return W.flash; },
    get viewFloor() { return W.viewFloor; },
    get floor() { return W.floor; },
    get blood() { return W.blood; },
    get kills() { return W.kills; },
    get score() { return W.score; },
    get stairDoors() { return W.stairDoors; },
    get hallUp() { return W.hallUp; },
    get hallDown() { return W.hallDown; },
    get fuses() { return W.fuses; },
    fuseOnFloor: fuseOnFloor,
    get fusesDone() { return fusesDone(); },
    get fuseTotal() { return W.fuses.length; },
    allFusesDone: allFusesDone,
    get lives() { return W.lives; },
    get threat() { return W.threat || 1; },
    get repair() { return W.repair; },
    get power() { return W.power; },
    nearFuse: nearFuse,
    nearExit: nearExit,
    playerUse: playerUse, boardOpenCar: boardOpenCar,
    panelVisible: panelVisible, canCall: canCall,
    get events() { return W.events; },
    get noises() { return W.noises; },
    update: update,
    get state() { return W; },
    get cfg() { return Cfg; },
    get geom() { return G; },
    elevAt: elevAt, carById: carById, carOpenAt: carOpenAt,
    los: los, canStand: canStand, wallsAt: wallsAt,
    doorRect: doorRect, doorOpenAmt: doorOpenAmt,
    addEvent: addEvent, emitNoise: emitNoise,
    boardCar: boardCar, exitCarToHall: exitCarToHall,
    startStairs: startStairs, otherLanding: otherLanding,
    countAliveKids: countAliveKids, countAliveKillers: countAliveKillers,
    endRound: endRound, catchKid: catchKid,
    playerMoveAxis: playerMoveAxis, playerTryStairs: playerTryStairs,
    playerToggleDoor: playerToggleDoor, playerCallElevator: playerCallElevator,
    playerPressCarFloor: playerPressCarFloor, playerToggleCarDoor: playerToggleCarDoor,
    playerExitCar: playerExitCar, nearDoor: nearDoor, nearStairs: nearStairs,
    dist: dist, rnd: rnd, clamp: clamp,
    __move: moveActor, __unstick: function(a){ unstick(a); }, autoOpenDoor: autoOpenDoor,
    navFind: function (a, to) { return (typeof Nav !== "undefined" && Nav) ? Nav.find({ x: a.x, y: a.y }, to) : null; },
    navGo: function (a, tx, ty, dt, speed) { return (typeof Nav !== "undefined" && Nav) ? Nav.goTo(API, a, tx, ty, dt, speed) : false; },
    __elevators: function () { return W.elevators; }
  };
  return API;
})();
