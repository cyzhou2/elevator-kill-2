/* ============================================================
 * ai.js · 小孩 AI 与杀人犯 AI
 * ------------------------------------------------------------
 * 小孩：瞎晃 → 看见它就往楼梯间跑 → 换层 → 继续晃
 * 杀人犯：扫楼 → 看到/听到 → 追 → 跟丢就搜 → 频道里互相通气
 * ============================================================ */
"use strict";

var AI = (function () {
  function rnd(a, b) { return a + (b - a) * Math.random(); }

  /* 把目标点挪到能站的地方（声音/情报可能落在墙里） */
  function safePoint(w, x, y, floor) {
    var r = 0.3;
    if (w.canStand(floor, x, y, r)) return { x: x, y: y };
    for (var step = 1; step <= 14; step++) {
      var d = step * 0.12;
      for (var k = 0; k < 12; k++) {
        var ang = (k / 12) * Math.PI * 2;
        var nx = x + Math.cos(ang) * d, ny = y + Math.sin(ang) * d;
        if (w.canStand(floor, nx, ny, r)) return { x: nx, y: ny };
      }
    }
    return { x: x, y: y };
  }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  /* 朝目标点走一步；被挡住就顺手开门。返回是否已经到达 */
  function steer(w, a, tx, ty, speed, dt) {
    var G = w.geom;
    var dx = tx - a.x, dy = ty - a.y;
    var d = Math.hypot(dx, dy);
    if (d < 0.1) return true;
    var ux = dx / d, uy = dy / d;
    a.face = Math.atan2(uy, ux);
    var px = a.x, py = a.y;
    w.__move(a, ux * speed * dt, uy * speed * dt, dt);
    if (a.space !== "floor") return false;
    var moved = Math.hypot(a.x - px, a.y - py);
    if (moved < speed * dt * 0.3) {
      var dA = G.stairDoorA.rect, dB = G.stairDoorB.rect;
      var L = null;
      if (dist(a.x, a.y, dA.x + dA.w / 2, dA.y + dA.h / 2) < 1.6) L = "A";
      else if (dist(a.x, a.y, dB.x + dB.w / 2, dB.y + dB.h / 2) < 1.6) L = "B";
      if (L) {
        var dd = w.state.stairDoors[a.floor][L];
        if (!dd.open) {
          dd.open = true; dd.closeTimer = 0;
          w.emitNoise(a.floor, a.x, a.y, w.cfg.DOOR.noise, "door");
        }
      }
    }
    return d < 0.16;
  }

  /* 门前的「站位点」：门洞外侧，人站得住 */
  function doorFront(G, L) {
    var dr = L === "A" ? G.stairDoorA.rect : G.stairDoorB.rect;
    var inward = L === "A" ? 0.62 : -0.62;      // 走廊一侧
    return { x: dr.x + dr.w / 2 + inward, y: dr.y + dr.h / 2 };
  }

  /* 走向楼梯口：门前 → 穿门 → 楼梯口。返回 true 表示已站到楼梯口 */
  function goToStairs(w, a, L, dt, speed) {
    var G = w.geom;
    var dr = L === "A" ? G.stairDoorA.rect : G.stairDoorB.rect;
    var zone = L === "A" ? G.stairZoneA : G.stairZoneB;
    var dd = w.state.stairDoors[a.floor][L];
    var gapX = dr.x + dr.w / 2, gapY = dr.y + dr.h / 2;
    var front = doorFront(G, L);
    /* 已经越过墙线（在楼梯间一侧） */
    var crossed = L === "A" ? a.x < dr.x + dr.w : a.x > dr.x;

    if (dd.amt < 0.6) {
      if (!crossed && Math.hypot(a.x - front.x, a.y - front.y) < 0.85) {
        if (!dd.open) {
          dd.open = true; dd.closeTimer = 0;
          w.emitNoise(a.floor, gapX, gapY, w.cfg.DOOR.noise, "door");
        }
      }
      steer(w, a, crossed ? gapX : front.x, gapY, speed, dt);
      return false;
    }
    if (!crossed) {
      var aligned = Math.abs(a.y - gapY) < 0.42;
      steer(w, a, aligned || Math.hypot(a.x - front.x, a.y - front.y) < 0.55 ? gapX : front.x, gapY, speed, dt);
      return false;
    }
    var cx = zone.x + zone.w / 2, cy = zone.y + 0.5;
    if (Math.hypot(a.x - cx, a.y - cy) < 0.6) return true;
    steer(w, a, cx, cy, speed, dt);
    return false;
  }

  /* 走楼梯换层 */
  function stairsTo(w, a, targetFloor, dt) {
    var G = w.geom;
    var dir = targetFloor > a.floor ? 1 : -1;
    var fA = doorFront(G, "A"), fB = doorFront(G, "B");
    var useA = Math.hypot(a.x - fA.x, a.y - fA.y) <= Math.hypot(a.x - fB.x, a.y - fB.y);
    var L = useA ? "A" : "B";
    if (goToStairs(w, a, L, dt, 1.6)) {
      if (!w.startStairs(a, L, dir)) w.startStairs(a, L, -dir);
    }
  }

  /* ================= 小孩 ================= */

  function kidUpdate(w, a, dt) {
    var C = w.cfg;
    a.aiTimer -= dt;

    if (a.space === "car") {
      var e = w.carById(a.carId);
      if (!e) { a.space = "floor"; return; }
      var goal = a.carGoal != null ? a.carGoal : 1;
      if (!e.calls.has(goal) && Math.abs(e.floor - goal) > 0.1) e.calls.add(goal);
      if (e.doorsOpen && Math.abs(e.floor - goal) < 0.1) {
        a.space = "floor"; a.floor = Math.round(e.floor);
        a.x = e.cx; a.y = w.geom.hallY0 + 0.4; a.carId = null; a.carGoal = null;
      }
      return;
    }
    if (a.space !== "floor") return;

    /* 看见杀人犯 → 跑 */
    var threat = null, td = 99;
    for (var i = 0; i < w.state.actors.length; i++) {
      var k = w.state.actors[i];
      if (k.kind !== "killer" || !k.alive || k.floor !== a.floor || k.space === "car") continue;
      if (!w.los(a.floor, a.x, a.y, k.x, k.y)) continue;
      var d = dist(a.x, a.y, k.x, k.y);
      if (d < 6.5 && d < td) { td = d; threat = k; }
    }

    if (threat) {
      a.aiState = "flee";
      a.fear = 1;
      var L = threat.x > a.x ? "A" : "B";
      if (goToStairs(w, a, L, dt, C.KID.sprint * 0.78)) {
        var dir = Math.random() < 0.5 ? 1 : -1;
        if (!w.startStairs(a, L, dir)) w.startStairs(a, L, -dir);
      }
      return;
    }
    a.fear = Math.max(0, (a.fear || 0) - dt * 0.4);

    if (a.aiTimer <= 0 && a.goalFloor == null) {
      a.aiTimer = rnd(7, 15);
      if (Math.random() < 0.45) {
        var nf = 1 + Math.floor(Math.random() * C.FLOORS);
        if (Math.abs(nf - a.floor) >= 2) { a.goalFloor = nf; }
      }
    }
    if (a.goalFloor != null) {
      if (a.floor === a.goalFloor) { a.goalFloor = null; a.aiTimer = rnd(1.5, 3.5); }
      else { stairsTo(w, a, a.goalFloor, dt); return; }
    }

    if (a.wanderX == null || Math.abs(a.x - a.wanderX) < 0.5) {
      a.wanderX = rnd(4, w.geom.L - 4);
      a.wanderY = rnd(0.7, w.geom.corridor.h - 0.7);
    }
    steer(w, a, a.wanderX, a.wanderY, C.KID.speed * 0.8, dt);
    a.aiState = "wander";
  }

  /* ================= 杀人犯 ================= */

  function killerUpdate(w, a, dt) {
    var C = w.cfg;

    if (a.space === "car") {
      var e = w.carById(a.carId);
      if (!e) { a.space = "floor"; return; }
      var goal = a.carGoal;
      if (goal == null) { a.space = "floor"; a.floor = Math.round(e.floor); a.x = e.cx; a.y = w.geom.hallY0 + 0.4; a.carId = null; return; }
      if (!e.calls.has(goal) && Math.abs(e.floor - goal) > 0.1) e.calls.add(goal);
      if (e.doorsOpen && Math.abs(e.floor - goal) < 0.1) {
        a.space = "floor"; a.floor = Math.round(e.floor);
        a.x = e.cx; a.y = w.geom.hallY0 + 0.4; a.carId = null; a.carGoal = null;
      }
      return;
    }
    if (a.space !== "floor") return;

    if (a.travel) { travelStep(w, a, dt); return; }

    a.aiTimer -= dt;
    if (a.aiTimer > 0) { stepKiller(w, a, dt); return; }
    a.aiTimer = C.KILLER.thinkSec;

    /* 1. 视野内的小孩 */
    var best = null, bd = 1e9;
    for (var i = 0; i < w.state.actors.length; i++) {
      var kid = w.state.actors[i];
      if (kid.kind !== "kid" || !kid.alive || kid.space === "stair") continue;
      if (kid.floor !== a.floor) continue;
      if (kid.space === "car" && Math.abs((w.carById(a.carId) || {}).floor || -99) > 99) continue;
      var d = dist(a.x, a.y, kid.x, kid.y);
      if (d > C.KILLER.sight) continue;
      if (!w.los(a.floor, a.x, a.y, kid.x, kid.y)) continue;
      var ang = Math.atan2(kid.y - a.y, kid.x - a.x);
      if (Math.abs(Geom.angDiff(ang, a.face)) > (kid.lightOn ? C.KILLER.sightCone * 1.5 : C.KILLER.sightCone)) continue;
      if (d < bd) { bd = d; best = kid; }
    }
    if (best) {
      a.state = "chase";
      a.target = { x: best.x, y: best.y, floor: best.floor };
      a.channel = { x: best.x, y: best.y, floor: best.floor, t: w.state.time };
      stepKiller(w, a, dt);
      return;
    }

    /* 2. 听到的动静 */
    if (a.heard && w.state.time - a.heard.t < 4 && !a.target) {
      a.state = "search";
      var hp = safePoint(w, a.heard.x, a.heard.y, a.floor);
      a.target = { x: hp.x, y: hp.y, floor: a.floor };
      stepKiller(w, a, dt);
      return;
    }

    /* 3. 频道情报 */
    var intel = channelIntel(w, a);
    if (intel && w.state.time - intel.t < 8) {
      if (intel.floor === a.floor) {
        a.state = "search";
        var ip = safePoint(w, intel.x, intel.y, a.floor);
        a.target = { x: ip.x, y: ip.y, floor: a.floor };
        stepKiller(w, a, dt);
        return;
      }
      setTravel(w, a, intel.floor);
      travelStep(w, a, dt);
      return;
    }

    /* 4. 扫楼 */
    a.state = "patrol";
    if (a.patrolFloor == null) a.patrolFloor = a.floor;
    if (a.floor !== a.patrolFloor) { setTravel(w, a, a.patrolFloor); travelStep(w, a, dt); return; }
    a.checked[a.floor] = w.state.time;

    if (a.target && a.target.floor !== a.floor) a.target = null;
    if (!a.target) {
      if (a.checkedThisFloor) {
        a.checkedThisFloor = false;
        a.patrolFloor = nextSweepFloor(w, a);
        if (a.patrolFloor !== a.floor) { setTravel(w, a, a.patrolFloor); travelStep(w, a, dt); return; }
      } else {
        a.target = patrolPoint(w, a, a.floor);
      }
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

  function patrolPoint(w, a, floor) {
    var G = w.geom;
    var r = Math.random();
    if (r < 0.36) return { x: G.hallCX + (Math.random() < 0.5 ? -1 : 1) * 1.2, y: G.hallY0 + 1.3, floor: floor };
    if (r < 0.7) return { x: G.corridor.x + 0.9 + Math.random() * (G.corridor.w - 1.8), y: G.corridor.h / 2, floor: floor };
    return { x: G.stairDoorA.rect.x + 0.9, y: G.corridor.h / 2, floor: floor };
  }

  function setTravel(w, a, floor) {
    if (a.travel && a.travel.floor === floor) return a.travel;
    var C = w.cfg;
    var df = Math.abs(floor - a.floor);
    var useCar = df >= 4 ? Math.random() > C.KILLER.preferStairs : Math.random() > 0.6;
    a.travel = { floor: floor, mode: useCar ? "car" : "stairs", pressed: false };
    return a.travel;
  }

  /* 每帧推进「去某层」这件事 */
  function travelStep(w, a, dt) {
    var t = a.travel;
    if (!t) return;
    if (a.space === "floor" && a.floor === t.floor) { a.travel = null; return; }
    if (t.mode === "stairs") { stairsTo(w, a, t.floor, dt); return; }

    var G = w.geom;
    var inHall = Geom.inRect(G.hall, a.x, a.y, -0.05);
    var opens = w.elevAt(a.floor), openCar = null;
    for (var i = 0; i < opens.length; i++) if (opens[i].doorsOpen) openCar = opens[i];

    if (openCar) {
      if (!inHall) { steer(w, a, G.hallCX, G.hallY0 + 1.1, 1.75, dt); return; }
      steer(w, a, openCar.cx, G.hallY0 - 0.25, 1.75, dt);
      if (a.space === "car") { a.carGoal = t.floor; a.travel = null; }
      return;
    }
    if (!inHall) { steer(w, a, G.hallCX, G.hallY0 + 1.1, 1.75, dt); return; }
    if (!t.pressed) {
      var set = (t.floor > a.floor ? w.state.hallUp : w.state.hallDown)[a.floor];
      set.add("C"); set.add("D");
      t.pressed = true;
    }
    steer(w, a, G.hallCX, G.hallY0 + 0.95, 1.3, dt);
  }

  function stepKiller(w, a, dt) {
    var C = w.cfg;
    if (a.space !== "floor") return;
    var speed = a.state === "chase" ? C.KILLER.chase : C.KILLER.patrol;
    if (a.target && a.target.floor === a.floor) {
      steer(w, a, a.target.x, a.target.y, speed, dt);
      if (dist(a.x, a.y, a.target.x, a.target.y) < 0.45) {
        a.target = null;
        if (a.state === "patrol") a.checkedThisFloor = true;
      }
    }
  }

  return {
    kidUpdate: kidUpdate,
    killerUpdate: killerUpdate,
    steer: steer,
    stairsTo: stairsTo
  };
})();
