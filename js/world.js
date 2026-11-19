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
    hallUp: [],         // hallUp[floor] = Set
    hallDown: [],
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

    W.time = 0; W.running = false; W.over = false; W.reason = null;
    W.actors = []; W.noises = []; W.events = []; W.blood = [];
    W.kills = 0; W.score = 0; W.shake = 0; W.flash = 0;
    W.tension = 0; W.heartbeat = 0; W.lastSeenKiller = null;

    W.hallUp = []; W.hallDown = []; W.stairDoors = [];
    for (var f = 0; f <= cfg.FLOORS; f++) {
      W.hallUp[f] = new Set();
      W.hallDown[f] = new Set();
      W.stairDoors[f] = {
        A: makeDoor("A", f), B: makeDoor("B", f)
      };
    }

    W.elevators = [
      { id: "C", floor: 1, dir: 0, state: "idle", timer: 0, calls: new Set(), doorsOpen: false, openAmt: 0, cx: G.elev.C.cx, car: G.elev.C.car, tag: "C" },
      { id: "D", floor: cfg.FLOORS, dir: 0, state: "idle", timer: 0, calls: new Set(), doorsOpen: false, openAmt: 0, cx: G.elev.D.cx, car: G.elev.D.car, tag: "D" }
    ];

    /* —— 玩家：一个小孩 —— */
    var p = spawnKid(0, cfg.START_FLOOR, G.corridor.x + 1.6, G.corridor.y + G.corridor.h / 2);
    p.controlled = true;
    W.player = p;
    W.actors.push(p);

    /* —— 其余小孩：随机楼层 —— */
    for (var i = 1; i < cfg.KIDS; i++) {
      var fk = 1 + Math.floor(rand() * cfg.FLOORS);
      W.actors.push(spawnKid(i, fk, rnd(4, G.L - 4), rnd(0.7, G.corridor.h - 0.7)));
    }

    /* —— 杀人犯：撒在楼上 —— */
    for (var k = 0; k < cfg.KILLERS; k++) {
      var fq = clamp(cfg.FLOORS - k * 4, 2, cfg.FLOORS);
      var kk = spawnKiller(k, fq, rnd(4, G.L - 4), rnd(0.7, G.corridor.h - 0.7));
      W.actors.push(kk);
    }

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

  function addEvent(text, kind, floor) {
    W.events.push({ t: W.time, text: text, kind: kind || "sys", floor: floor == null ? null : floor });
    if (W.events.length > 300) W.events.shift();
  }

  function emitNoise(floor, x, y, radius, kind) {
    W.noises.push({ floor: floor, x: x, y: y, r: radius, kind: kind, t: W.time });
    for (var i = 0; i < W.actors.length; i++) {
      var a = W.actors[i];
      if (a.kind !== "killer" || !a.alive || a.floor !== floor) continue;
      if (dist(a.x, a.y, x, y) <= radius) {
        a.heard = { x: x, y: y, t: W.time, kind: kind };
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

    if (canStand(a.floor, nx, a.y, r)) a.x = nx;
    if (canStand(a.floor, a.x, ny, r)) a.y = ny;

    /* 走进电梯井 = 进轿厢 */
    for (var i = 0; i < W.elevators.length; i++) {
      var e = W.elevators[i];
      if (!carOpenAt(e, a.floor)) continue;
      if (inCarRect(e.id, a.x, a.y, r * 0.2)) {
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

  function hasCall(e, f, dir) {
    if (e.calls.has(f)) return true;
    if (dir > 0) return W.hallUp[f].has(e.id);
    if (dir < 0) return W.hallDown[f].has(e.id);
    return false;
  }

  function anyCall(e) {
    if (e.calls.size) return true;
    for (var f = 1; f <= Cfg.FLOORS; f++) if (W.hallUp[f].size || W.hallDown[f].size) return true;
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
      if (!hasCall(e, f, 1) && !hasCall(e, f, -1) && !e.calls.has(f)) continue;
      var d = Math.abs(f - e.floor);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function clearFloorCalls(e, f, dir) {
    e.calls.delete(f);
    /* 呼梯是共用的：谁来服务就整层清掉，另一部梯也不再来 */
    if (dir > 0) W.hallUp[f].clear();
    else if (dir < 0) W.hallDown[f].clear();
    /* 这个方向没有别的活儿了，就顺手把同层反方向的也带走（避免为它再开一次门） */
    if (!stopsAhead(e, dir).length) {
      if (dir > 0) W.hallDown[f].clear();
      if (dir < 0) W.hallUp[f].clear();
    }
  }

  function openDoors(e, f) {
    e.floor = f;
    e.state = "opening";
    e.timer = Cfg.ELEV.doorOpenSec;
    e.doorsOpen = false;
    e.openedFor = dir2(e);
    clearFloorCalls(e, f, e.dir === 0 ? 1 : e.dir);
    emitNoise(f, e.cx, G.hallY0 + 0.5, 4.0, "elev");
  }
  function dir2(e) { return e.dir || 1; }

  function planElevator(e) {
    if (e.dir !== 0 && stopsAhead(e, e.dir).length) { e.state = "moving"; return; }
    if (e.dir !== 0 && stopsAhead(e, -e.dir).length) { e.dir = -e.dir; e.state = "moving"; return; }
    var n = nearestCall(e);
    if (n != null) {
      if (Math.abs(n - e.floor) < 0.06) { openDoors(e, n); return; }
      e.dir = n > e.floor ? 1 : -1;
      e.state = "moving";
      return;
    }
    e.dir = 0;
    e.state = "idle";
  }

  function updateElevator(e, dt) {
    switch (e.state) {
      case "idle":
        if (anyCall(e)) planElevator(e);
        break;
      case "moving": {
        if (e.dir === 0) { planElevator(e); break; }
        var nextInt = e.dir > 0 ? Math.ceil(e.floor - 1e-6) : Math.floor(e.floor + 1e-6);
        if (Math.abs(nextInt - e.floor) < 1e-3) nextInt += e.dir;
        nextInt = clamp(nextInt, 1, Cfg.FLOORS);
        var step = (1 / Cfg.ELEV.secPerFloor) * dt;
        var d = nextInt - e.floor;
        if (Math.abs(d) <= step) {
          e.floor = nextInt;
          if (hasCall(e, nextInt, e.dir) || e.calls.has(nextInt)) {
            openDoors(e, nextInt);
          } else if ((e.dir > 0 && nextInt >= Cfg.FLOORS) || (e.dir < 0 && nextInt <= 1)) {
            e.dir = -e.dir;
            if (!stopsAhead(e, e.dir).length && !anyCall(e)) { e.dir = 0; e.state = "idle"; }
          }
        } else {
          e.floor += e.dir * step;
        }
        break;
      }
      case "opening":
        e.timer -= dt;
        e.openAmt = Math.min(1, e.openAmt + dt / Cfg.ELEV.doorOpenSec);
        if (e.timer <= 0) { e.state = "open"; e.doorsOpen = true; e.openAmt = 1; e.timer = Cfg.ELEV.doorHoldSec; }
        break;
      case "open":
        e.openAmt = 1;
        e.timer -= dt;
        if (e.timer <= 0) { e.state = "closing"; e.timer = Cfg.ELEV.doorCloseSec; }
        break;
      case "closing":
        e.doorsOpen = false;
        e.timer -= dt;
        e.openAmt = Math.max(0, e.openAmt - dt / Cfg.ELEV.doorCloseSec);
        /* 关门途中有人按开门 / 门区有人 → 重新打开 */
        if (W.hallUp[Math.round(e.floor)] && (W.hallUp[Math.round(e.floor)].size || W.hallDown[Math.round(e.floor)].size) && Math.abs(e.floor - Math.round(e.floor)) < 0.06) {
          // 楼层呼梯会自然触发重开
        }
        if (e.timer <= 0) { e.openAmt = 0; planElevator(e); }
        break;
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

    /* 玩家楼层 */
    if (W.player && W.player.space === "floor") W.floor = W.player.floor;

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

    /* 时间到 */
    if (W.time >= Cfg.ROUND_SEC) endRound("time");
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
    if (canSprint) p.stamina = Math.max(0, p.stamina - Cfg.KID.staminaDrain * dt);
    else p.stamina = Math.min(Cfg.KID.stamina, p.stamina + Cfg.KID.staminaRegen * dt);

    if (len > 0.1) p.face = Math.atan2(dy, dx);
    var moved = moveActor(p, dx * sp * dt, dy * sp * dt, dt);
    /* 脚步声 */
    p.stepAcc = (p.stepAcc || 0) + sp * dt;
    var stride = canSprint ? 1.5 : 1.05;
    if (p.stepAcc > stride) {
      p.stepAcc = 0;
      emitNoise(p.floor, p.x, p.y, canSprint ? Cfg.KILLER.hearSprint : Cfg.KILLER.hearWalk, canSprint ? "sprint" : "walk");
      if (window.Audio2) Audio2.footstep(canSprint, p.floor === W.viewFloor);
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

  function playerCallElevator(dx) {
    var p = W.player;
    if (!p || !p.alive || p.space !== "floor") return false;
    var inHall = Geom.inRect(G.hall, p.x, p.y, -0.05);
    if (!inHall) return false;
    var set = (dx > 0 ? W.hallUp : W.hallDown)[p.floor];
    set.add("C"); set.add("D");
    if (window.Audio2) Audio2.ding(0.4);
    if (p.controlled) addEvent("你按了 " + p.floor + "F 的" + (dx > 0 ? "▲" : "▼"), "you", p.floor);
    return true;
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
    if (!e || !e.doorsOpen) return false;
    exitCarToHall(p);
    W.floor = p.floor;
    return true;
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
    __move: moveActor, __unstick: function(a){ unstick(a); },
    __elevators: function () { return W.elevators; }
  };
  return API;
})();
