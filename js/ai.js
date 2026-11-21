/* ============================================================
 * ai.js · 小孩 AI / 杀人犯 AI
 * ------------------------------------------------------------
 * - 一律用 Nav 网格寻路，不再"直勾勾"地往墙上撞；路上自动开门
 * - 目标锁定：决定之后 2~6 秒不改主意，到站先歇一会儿 → 不抽搐
 * - 逃跑只认一个楼梯间，直到换层成功
 * ============================================================ */
"use strict";

var AI = (function () {
  function rnd(a, b) { return a + (b - a) * Math.random(); }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  function doorFront(G, L) {
    var dr = L === "A" ? G.stairDoorA.rect : G.stairDoorB.rect;
    return { x: dr.x + dr.w / 2 + (L === "A" ? 0.8 : -0.8), y: dr.y + dr.h / 2 };
  }

  /* 走到楼梯口（Nav 自己穿门、自己推门） */
  function goStairZone(w, a, L, dt, speed) {
    var G = w.geom;
    /* 门被拉上了：先推开（小孩开得快） */
    var st = w.state.stairDoors[a.floor] && w.state.stairDoors[a.floor][L];
    if (st && !st.open && !st.broken) {
      w.autoOpenDoor(a);
      return false;
    }
    var zone = L === "A" ? G.stairZoneA : G.stairZoneB;
    var tx = zone.x + zone.w / 2, ty = zone.y + 0.6;
    if (dist(a.x, a.y, tx, ty) < 0.75) return true;
    if (w.navGo) w.navGo(a, tx, ty, dt, speed);
    return dist(a.x, a.y, tx, ty) < 0.75;
  }

  /* ================= 小孩 ================= */

  function kidUpdate(w, a, dt) {
    var C = w.cfg, G = w.geom, now = w.state.time;

    if (a.space === "car") {
      var e = w.carById(a.carId);
      if (!e) { a.space = "floor"; return; }
      var goal = a.carGoal != null ? a.carGoal : 1;
      if (!e.calls.has(goal) && Math.abs(e.floor - goal) > 0.1) e.calls.add(goal);
      if (e.doorsOpen && Math.abs(e.floor - goal) < 0.1) {
        a.space = "floor"; a.floor = Math.round(e.floor);
        a.x = e.cx; a.y = G.hallY0 + 0.4; a.carId = null; a.carGoal = null;
      }
      return;
    }
    if (a.space !== "floor") return;

    /* 看得见它？ */
    var threat = null, td = 99;
    for (var i = 0; i < w.state.actors.length; i++) {
      var k = w.state.actors[i];
      if (k.kind !== "killer" || !k.alive || k.floor !== a.floor || k.space !== "floor") continue;
      var d = dist(a.x, a.y, k.x, k.y);
      if (d > 6.5 || d >= td) continue;
      if (!w.los(a.floor, a.x, a.y, k.x, k.y)) continue;
      threat = k; td = d;
    }

    if (threat) {
      a.aiState = "flee";
      if (!a.fleeL || now > (a.fleeUntil || 0)) {
        a.fleeL = threat.x > a.x ? "A" : "B";
        a.fleeUntil = now + 2.5;
      }
      if (goStairZone(w, a, a.fleeL, dt, C.KID.sprint * 0.70)) {
        var dir = threat.floor > a.floor ? -1 : 1;
        if (!w.startStairs(a, a.fleeL, dir)) w.startStairs(a, a.fleeL, -dir);
        a.fleeL = null;
      }
      return;
    }
    a.fleeL = null;

    /* 换层计划 */
    if (a.goalFloor != null) {
      if (a.floor === a.goalFloor) {
        a.goalFloor = null;
        a.restUntil = now + rnd(1.2, 2.6);
        a.path = null;
        return;
      }
      if (!a.travelL || now > (a.travelUntil || 0)) {
        a.travelL = Math.random() < 0.5 ? "A" : "B";
        a.travelUntil = now + 6;
      }
      if (goStairZone(w, a, a.travelL, dt, C.KID.speed * 0.95)) {
        var df = a.goalFloor > a.floor ? 1 : -1;
        if (!w.startStairs(a, a.travelL, df)) w.startStairs(a, a.travelL, -df);
        a.travelL = null;
      }
      a.aiState = "travel";
      return;
    }
    a.travelL = null;

    if (now < (a.restUntil || 0)) { a.path = null; a.aiState = "rest"; return; }

    a.aiTimer -= dt;
    if (a.aiTimer <= 0) {
      a.aiTimer = rnd(7, 14);
      if (Math.random() < 0.45) {
        var nf = 1 + Math.floor(Math.random() * C.FLOORS);
        if (Math.abs(nf - a.floor) >= 2) { a.goalFloor = nf; return; }
      }
    }

    /* 本层晃：一个目标走到底，到了先歇 1~3 秒 */
    if (!a.wander) {
      a.wander = {
        x: rnd(G.corridor.x + 0.8, G.corridor.x + G.corridor.w - 0.8),
        y: rnd(0.7, G.corridor.h - 0.7)
      };
      a.path = null;
    }
    if (dist(a.x, a.y, a.wander.x, a.wander.y) < 0.55) {
      a.wander = null;
      a.restUntil = now + rnd(1.0, 3.0);
      a.path = null;
      return;
    }
    if (w.navGo) w.navGo(a, a.wander.x, a.wander.y, dt, C.KID.speed * 0.8);
    a.aiState = "wander";
  }

  /* ================= 杀人犯 ================= */

  /**
   * 每帧感知：先看视野锥，再兜底"贴身 360°"。
   * 返回 {kid, kind:'sight'|'sense'} 或 null。
   */
  function detectKid(w, a) {
    var C = w.cfg;
    var best = null, bd = 1e9;
    var near = null, nd = 1e9;
    for (var i = 0; i < w.state.actors.length; i++) {
      var kid = w.state.actors[i];
      if (kid.kind !== "kid" || !kid.alive) continue;
      if (kid.space !== "floor" || kid.floor !== a.floor) continue;
      var d = dist(a.x, a.y, kid.x, kid.y);
      if (d > C.KILLER.sight) continue;
      if (!w.los(a.floor, a.x, a.y, kid.x, kid.y)) continue;

      /* 视野锥 */
      var ang = Math.atan2(kid.y - a.y, kid.x - a.x);
      var half = kid.lightOn ? C.KILLER.sightCone * 1.5 : C.KILLER.sightCone;
      if (Math.abs(Geom.angDiff(ang, a.face)) <= half) {
        if (d < bd) { bd = d; best = kid; }
        continue;
      }
      /* 贴脸：朝哪边都能察觉到（要等 senseDelay 确认） */
      if (d <= (C.KILLER.senseRadius || 2.6) && d < nd) { nd = d; near = kid; }
    }
    if (best) return { kid: best, kind: "sight" };
    if (near) return { kid: near, kind: "sense" };
    return null;
  }

  function startChase(w, a, kid, now) {
    if (a.state !== "chase" && window.Audio2 && window.Audio2.stinger) Audio2.stinger();
    a.state = "chase";
    a.chaseKid = kid.id;
    a.target = { x: kid.x, y: kid.y, floor: kid.floor };
    a.channel = { x: kid.x, y: kid.y, floor: kid.floor, t: now };
  }

  function killerUpdate(w, a, dt) {
    var C = w.cfg, G = w.geom, now = w.state.time;

    /* 擦刀：得手后收刀 1.7 秒，原地不动 */
    if (a.recoverT > 0) {
      a.state = "recover";
      a.path = null;
      a.breakingAt = null;
      return;
    }
    if (a.space === "floor" && !a.travel && w.nearStairs && w.nearStairs()) {
      /* 站在楼梯口却没打算换层：说明目标就在本层，走出去 */
      a.path = null;
    }

    /* 门被拉上了：不管它在追人还是换层，挡在路上就砸（已经开始砸的继续砸完） */
    if (a.space === "floor") {
      var bd0 = blockedDoor(w, a);
      var tag0 = bd0 ? (bd0.pallet != null ? "P" + bd0.pallet : bd0.L) : null;
      if (bd0 && (a.state === "chase" || a.travel || a.heard || a.breakingAt === tag0)) {
        smash(w, a, bd0, dt);
        return;
      }
      if (!bd0) a.breakingAt = null;
    }

    if (a.space === "car") {
      var e = w.carById(a.carId);
      if (!e) { a.space = "floor"; return; }
      if (a.carGoal == null) {
        a.space = "floor"; a.floor = Math.round(e.floor);
        a.x = e.cx; a.y = G.hallY0 + 0.4; a.carId = null; return;
      }
      if (!e.calls.has(a.carGoal) && Math.abs(e.floor - a.carGoal) > 0.1) e.calls.add(a.carGoal);
      if (e.doorsOpen && Math.abs(e.floor - a.carGoal) < 0.1) {
        a.space = "floor"; a.floor = Math.round(e.floor);
        a.x = e.cx; a.y = G.hallY0 + 0.4; a.carId = null; a.carGoal = null;
      }
      return;
    }
    if (a.space !== "floor") return;

    /* 每帧感知：有人在旁边/视线里，优先于一切（包括"要去别的楼层"） */
    var det = detectKid(w, a);
    if (det) {
      if (det.kind === "sense") {
        if (a.senseId !== det.kid.id) { a.senseId = det.kid.id; a.senseAt = now; }
        if (now - (a.senseAt || 0) >= (C.KILLER.senseDelay || 0.45)) det.kind = "sight";
      }
      if (det.kind === "sight") {
        a.senseId = null;
        startChase(w, a, det.kid, now);
        stepKiller(w, a, dt);
        return;
      }
    } else {
      a.senseId = null;
    }

    /* 修理声（结构噪音）优先级高于"本来要去的那层"，但低于正在追人 */
    if (a.state !== "chase" && a.heard && a.heard.kind === "muffled" &&
        a.heard.floor != null && a.heard.floor !== a.floor &&
        now - a.heard.t < 4) {
      if (!a.travel || a.travel.floor !== a.heard.floor) setTravel(w, a, a.heard.floor);
      travelStep(w, a, dt);
      return;
    }

    if (a.travel) { travelStep(w, a, dt); return; }

    a.aiTimer -= dt;
    if (a.aiTimer > 0) { stepKiller(w, a, dt); return; }
    a.aiTimer = C.KILLER.thinkSec;

    /* 1. 视野内的小孩 */
    var best = null, bd = 1e9;
    for (var i = 0; i < w.state.actors.length; i++) {
      var kid = w.state.actors[i];
      if (kid.kind !== "kid" || !kid.alive || kid.space !== "floor") continue;
      if (kid.floor !== a.floor) continue;
      var d = dist(a.x, a.y, kid.x, kid.y);
      if (d > C.KILLER.sight || d >= bd) continue;
      if (!w.los(a.floor, a.x, a.y, kid.x, kid.y)) continue;
      var ang = Math.atan2(kid.y - a.y, kid.x - a.x);
      if (Math.abs(Geom.angDiff(ang, a.face)) > (kid.lightOn ? C.KILLER.sightCone * 1.5 : C.KILLER.sightCone)) continue;
      best = kid; bd = d;
    }
    if (best) {
      if (a.state !== "chase" && window.Audio2 && window.Audio2.stinger) Audio2.stinger();
      a.state = "chase";
      a.chaseKid = best.id;
      a.target = { x: best.x, y: best.y, floor: best.floor };
      a.path = null;
      a.channel = { x: best.x, y: best.y, floor: best.floor, t: now };
      stepKiller(w, a, dt);
      return;
    }

    /* 2. 听到的动静（修理声最容易把它引过来） */
    if (a.heard && now - a.heard.t < (a.heard.kind === "repair" ? 9 : 4)) {
      if (a.heard.floor != null && a.heard.floor !== a.floor) {
        a.state = "patrol";
        setTravel(w, a, a.heard.floor);
        travelStep(w, a, dt);
        return;
      }
      a.state = "search";
      a.target = { x: a.heard.x, y: a.heard.y, floor: a.floor };
      a.path = null;
      stepKiller(w, a, dt);
      return;
    }

    /* 3. 频道情报 */
    var intel = channelIntel(w, a);
    if (intel && now - intel.t < 8) {
      if (intel.floor === a.floor) {
        a.state = "search";
        a.target = { x: intel.x, y: intel.y, floor: a.floor };
        a.path = null;
        stepKiller(w, a, dt);
        return;
      }
      a.state = "patrol";
      setTravel(w, a, intel.floor);
      travelStep(w, a, dt);
      return;
    }

    /* 4. 扫楼 */
    a.state = "patrol";
    if (a.patrolFloor == null) a.patrolFloor = a.floor;
    if (a.floor !== a.patrolFloor) {
      setTravel(w, a, a.patrolFloor);
      travelStep(w, a, dt);
      return;
    }
    a.checked[a.floor] = now;

    if (a.target && a.target.floor === a.floor && dist(a.x, a.y, a.target.x, a.target.y) < 0.6) {
      a.target = null;
      a.checkedThisFloor = true;
    }
    if (!a.target) {
      if (a.checkedThisFloor) {
        a.checkedThisFloor = false;
        a.patrolFloor = nextSweepFloor(w, a);
        if (a.patrolFloor !== a.floor) { setTravel(w, a, a.patrolFloor); travelStep(w, a, dt); return; }
      }
      a.target = patrolPoint(w, a);
      a.path = null;
    }
    stepKiller(w, a, dt);
  }

  function channelIntel(w, a) {
    var best = null;
    for (var i = 0; i < w.state.actors.length; i++) {
      var o = w.state.actors[i];
      if (o === a || o.kind !== "killer" || !o.alive || !o.channel) continue;
      if (!best || o.channel.t > best.t) best = o.channel;
    }
    return best;
  }

  function nextSweepFloor(w, a) {
    var C = w.cfg, span = C.KILLER.sweepSpan, cool = C.KILLER.checkedCool;
    var base = a.floor;
    for (var t = 0; t < 4; t++) {
      var nf = base + a.patrolDir * span;
      if (nf > C.FLOORS) { a.patrolDir = -1; nf = base - span; }
      if (nf < 1) { a.patrolDir = 1; nf = base + span; }
      nf = Math.max(1, Math.min(C.FLOORS, nf));
      var t0 = a.checked[nf];
      if (!t0 || w.state.time - t0 > cool) return nf;
      base = nf;
    }
    return 1 + Math.floor(Math.random() * C.FLOORS);
  }

  function patrolPoint(w, a) {
    var G = w.geom, r = Math.random();
    if (r < 0.4) return { x: G.hallCX + (Math.random() < 0.5 ? -1 : 1) * 1.2, y: G.hallY0 + 1.3, floor: a.floor };
    if (r < 0.78) return { x: rnd(G.corridor.x + 0.9, G.corridor.x + G.corridor.w - 0.9), y: G.corridor.h / 2, floor: a.floor };
    return { x: doorFront(G, Math.random() < 0.5 ? "A" : "B").x, y: G.corridor.h / 2, floor: a.floor };
  }

  /* ---------- 换层 ---------- */

  function setTravel(w, a, floor) {
    if (a.travel && a.travel.floor === floor) return;
    var C = w.cfg;
    var df = Math.abs(floor - a.floor);
    var useCar = df >= 4 ? Math.random() > C.KILLER.preferStairs : Math.random() > 0.62;
    a.travel = { floor: floor, mode: useCar ? "car" : "stairs", pressed: false, L: null };
    a.path = null;
  }

  function travelStep(w, a, dt) {
    var t = a.travel, G = w.geom;
    if (!t) return;
    if (a.space === "floor" && a.floor === t.floor) { a.travel = null; a.path = null; t = null; return; }
    if (a.space !== "floor") return;

    if (t.mode === "stairs") {
      if (!t.L) t.L = Math.random() < 0.5 ? "A" : "B";
      if (goStairZone(w, a, t.L, dt, 1.7)) {
        var dir = t.floor > a.floor ? 1 : -1;
        /* 上不去就试反方向；都上不去就换个楼梯间 */
        if (!w.startStairs(a, t.L, dir) && !w.startStairs(a, t.L, -dir)) t.L = null;
        /* travel 不清：等真的换层后由顶部判断清掉 */
      }
      return;
    }

    var inHall = Geom.inRect(G.hall, a.x, a.y, -0.05);
    var opens = w.elevAt(a.floor), openCar = null;
    for (var i = 0; i < opens.length; i++) if (opens[i].doorsOpen) openCar = opens[i];
    if (openCar) {
      if (!inHall) { if (w.navGo) w.navGo(a, G.hallCX, G.hallY0 + 1.1, dt, 1.75); return; }
      var dx = openCar.cx - a.x, dy = (G.hallY0 - 0.25) - a.y, d = Math.hypot(dx, dy) || 1;
      w.__move(a, (dx / d) * 1.75 * dt, (dy / d) * 1.75 * dt, dt);
      if (a.space === "car") { a.carGoal = t.floor; a.travel = null; }
      return;
    }
    /* 等太久就改走楼梯，别在厅里站到天亮 */
    t.waitT = (t.waitT || 0) + dt;
    if (t.waitT > 9) { t.mode = "stairs"; t.waitT = 0; t.pressed = false; return; }
    if (!inHall) { if (w.navGo) w.navGo(a, G.hallCX, G.hallY0 + 1.1, dt, 1.75); return; }
    t.pressT = (t.pressT || 0) - dt;
    if (!t.pressed || t.pressT <= 0) {
      var up = t.floor >= a.floor;
      if (up && a.floor < w.cfg.FLOORS) w.state.hallUp[a.floor] = true;
      if (!up && a.floor > 1) w.state.hallDown[a.floor] = true;
      t.pressed = true;
      t.pressT = 2.5;
    }
    if (w.navGo) w.navGo(a, G.hallCX, G.hallY0 + 0.95, dt, 1.4);
  }

  /** 门挡在前面吗？返回挡路的门 {L,x,y} 或 null */
  function blockedDoor(w, a) {
    var G = w.geom;
    /* 走廊板子 */
    var plist = w.state.pallets && w.state.pallets[a.floor];
    if (plist && G.pallets) {
      for (var pi = 0; pi < plist.length; pi++) {
        var pst = plist[pi];
        if (!pst || pst.open || pst.broken) continue;
        var pr = G.pallets[pi];
        var pcx = pr.x + pr.w / 2, pcy = pr.y + pr.h / 2;
        if (Math.abs(a.x - pcx) > 1.15) continue;
        if (a.y < pr.y - 0.3 || a.y > pr.y + pr.h + 0.3) continue;
        return { pallet: pi, x: pcx, y: a.y };
      }
    }
    /* 楼梯间门 */
    for (var i = 0; i < 2; i++) {
      var L = i === 0 ? "A" : "B";
      var st = w.state.stairDoors[a.floor][L];
      if (!st || st.open || st.broken) continue;
      var dr = L === "A" ? G.stairDoorA.rect : G.stairDoorB.rect;
      var cx = dr.x + dr.w / 2, cy = dr.y + dr.h / 2;
      if (dist(a.x, a.y, cx, cy) > 1.15) continue;
      return { L: L, x: cx, y: cy };
    }
    return null;
  }

  /** 砸挡路的东西（门或板子） */
  function smash(w, a, bd, dt) {
    if (bd.pallet != null) {
      a.breakingAt = "P" + bd.pallet;
      a.face = Math.atan2(0, bd.x - a.x);
      w.breakPallet(a, a.floor, bd.pallet, dt);
    } else {
      a.breakingAt = bd.L;
      a.face = Math.atan2(bd.y - a.y, bd.x - a.x);
      w.breakDoor(a, a.floor, bd.L, dt);
    }
  }

  function stepKiller(w, a, dt) {
    var C = w.cfg;
    if (a.space !== "floor") return;

    /* 门被拉上了：先砸门（追击里最紧张的一段） */
    var bd = blockedDoor(w, a);
    if (bd) { smash(w, a, bd, dt); return; }
    a.breakingAt = null;

    /* 追人的时候盯住本人，不追他刚才的位置 */
    if (a.state === "chase" && a.chaseKid) {
      for (var ci = 0; ci < w.state.actors.length; ci++) {
        var ck = w.state.actors[ci];
        if (ck.id !== a.chaseKid) continue;
        if (!ck.alive || ck.space !== "floor" || ck.floor !== a.floor) { a.chaseKid = null; break; }
        a.target = { x: ck.x, y: ck.y, floor: ck.floor };
        break;
      }
    }
    if (!a.target || a.target.floor !== a.floor) return;
    var th = w.threat || 1;
    var speed = (a.state === "chase" ? C.KILLER.chase : C.KILLER.patrol) * th;
    var done = false;
    if (w.navGo) done = w.navGo(a, a.target.x, a.target.y, dt, speed);
    else {
      var dx = a.target.x - a.x, dy = a.target.y - a.y, d = Math.hypot(dx, dy) || 1;
      w.__move(a, (dx / d) * speed * dt, (dy / d) * speed * dt, dt);
      done = d < 0.25;
    }
    if (done || dist(a.x, a.y, a.target.x, a.target.y) < 0.4) {
      a.target = null;
      if (a.state === "chase") { a.state = "search"; a.chaseKid = null; }
      else if (a.state === "patrol") a.checkedThisFloor = true;
    }
  }

  return {
    kidUpdate: kidUpdate,
    killerUpdate: killerUpdate,
    goStairZone: goStairZone,
    doorFront: doorFront
  };
})();
