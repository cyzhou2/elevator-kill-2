/* ============================================================
 * main.js · 主循环与交互装配
 * ============================================================ */
"use strict";

(function () {
  var world = null;
  var paused = false;
  var over = false;
  var last = 0;
  var running = false;
  var walkTarget = null;
  var lastMoveY = 0;
  var started = false;
  var lastSpace = null;

  function $(id) { return document.getElementById(id); }

  function boot() {
    world = World.init(CFG);
    over = false;
    paused = false;
    walkTarget = null;
    started = true;
    last = 0;
    Input.clearClick();
    UI.hideEnd();
    UI.showPause(false);
    Render.resize();
    Render.bake();
    Render.layout();
    UI.update(world, 0);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  function restart() { boot(); }

  /* ---------- 动作 ---------- */

  function doAction(a) {
    var p = world.player;
    if (!p || !p.alive || over) return;
    if (p.space === "stair") return;

    if (a === "interact") {
      if (p.space === "car") { World.playerToggleCarDoor(true); return; }
      if (World.nearStairs()) { World.playerTryStairs(1); return; }
      if (World.nearDoor()) { World.playerToggleDoor(); return; }
      if (Geom.inRect(world.geom.hall, p.x, p.y, -0.05)) { World.playerCallElevator(1); return; }
    }
    if (a === "interactDown") {
      if (p.space === "car") { World.playerToggleCarDoor(false); return; }
      if (World.nearStairs()) { World.playerTryStairs(-1); return; }
    }
    if (a === "space") {
      if (p.space === "car") World.playerExitCar();
      return;
    }
    if (a === "light") {
      p.lightOn = !p.lightOn;
      UI.toast(p.lightOn ? "手电已开" : "手电已关");
      return;
    }
    if (a === "pause") { togglePause(); return; }
    if (a === "mute") { Audio2.setMute(!Audio2.muted); UI.toast(Audio2.muted ? "静音" : "声音已开"); return; }
  }

  function togglePause() {
    if (over) return;
    paused = !paused;
    UI.showPause(paused);
  }

  function handleClick(pt) {
    var p = world.player;
    if (!p || !p.alive || over) return;
    if (p.space === "stair") return;
    if (p.space === "car") return;

    var g = world.geom;

    /* 楼梯间门 */
    var dA = g.stairDoorA.rect, dB = g.stairDoorB.rect;
    if (World.dist(pt.x, pt.y, dA.x + dA.w / 2, dA.y + dA.h / 2) < 0.85 ||
      World.dist(pt.x, pt.y, dB.x + dB.w / 2, dB.y + dB.h / 2) < 0.85) {
      World.playerToggleDoor.call(null);
      /* 距离太远就先走过去 */
      var L = World.dist(pt.x, pt.y, dA.x, dA.y) < World.dist(pt.x, pt.y, dB.x, dB.y) ? "A" : "B";
      var dr = L === "A" ? dA : dB;
      if (World.dist(p.x, p.y, dr.x + dr.w / 2, dr.y + dr.h / 2) > 1.35) {
        walkTarget = { x: dr.x + dr.w / 2, y: dr.y + dr.h / 2 };
      }
      return;
    }

    /* 呼梯按钮 */
    var cC = g.elev.C.gap, cD = g.elev.D.gap;
    var nearC = Math.abs(pt.x - (cC.x + cC.w / 2)) < 0.5 && Math.abs(pt.y - cC.y) < 0.6;
    var nearD = Math.abs(pt.x - (cD.x + cD.w / 2)) < 0.5 && Math.abs(pt.y - cD.y) < 0.6;
    if (nearC || nearD) {
      if (Geom.inRect(g.hall, p.x, p.y, -0.05)) World.playerCallElevator(1);
      else walkTarget = { x: g.hallCX, y: g.hallY0 + 1.1 };
      return;
    }

    /* 楼梯通道：点上半段上楼，下半段下楼 */
    if (Geom.inRect(g.stairZoneA, pt.x, pt.y, 0) || Geom.inRect(g.stairZoneB, pt.x, pt.y, 0)) {
      if (World.nearStairs()) {
        World.playerTryStairs(pt.y < g.stairZoneA.y + g.stairZoneA.h / 2 ? 1 : -1);
      } else {
        walkTarget = { x: pt.x, y: g.stairZoneA.y + 0.45 };
      }
      return;
    }

    /* 电梯门开着，点轿厢 = 进去 */
    for (var i = 0; i < world.elevators.length; i++) {
      var e = world.elevators[i];
      var car = e.id === "C" ? g.elev.C.car : g.elev.D.car;
      if (e.doorsOpen && Math.abs(e.floor - p.floor) < 0.06 && Geom.inRect(car, pt.x, pt.y, 0)) {
        walkTarget = { x: e.cx, y: g.hallY0 - 0.3 };
        return;
      }
    }

    walkTarget = { x: pt.x, y: pt.y };
  }

  /* ---------- 主循环 ---------- */

  function loop(ts) {
    var now = ts / 1000;
    if (!last) last = now;
    var dt = Math.min(0.05, now - last);
    last = now;

    if (!paused && !over) step(dt);
    Render.draw(world, dt);
    UI.update(world, dt);
    requestAnimationFrame(loop);
  }

  function step(dt) {
    var acts = Input.consume();
    for (var i = 0; i < acts.length; i++) {
      if (typeof acts[i] === "string") doAction(acts[i]);
      else if (acts[i] && acts[i].click) handleClick(acts[i].click);
    }
    if (over) return;

    var mv = Input.poll();
    var p = world.player;

    /* 楼梯间里 W/S = 上下楼 */
    if (p && p.space === "floor" && World.nearStairs() && Math.abs(mv.y) > 0.4) {
      if (lastMoveY * mv.y <= 0) {
        World.playerTryStairs(mv.y < 0 ? 1 : -1);
      }
      lastMoveY = mv.y;
      world.update(dt);
      afterUpdate(dt);
      return;
    }
    lastMoveY = Math.abs(mv.y) > 0.4 ? mv.y : 0;

    /* 点地走路 */
    var dx = mv.x, dy = mv.y, sprint = mv.sprint;
    if (walkTarget) {
      var ddx = walkTarget.x - p.x, ddy = walkTarget.y - p.y;
      var d = Math.hypot(ddx, ddy);
      if (d < 0.18 || (Math.abs(mv.x) > 0.3 || Math.abs(mv.y) > 0.3)) {
        walkTarget = null;
      } else {
        dx = ddx / d; dy = ddy / d;
        sprint = d > 3 && p.stamina > 30;
      }
    }

    if (p && p.alive) World.playerMoveAxis(dx, dy, sprint, dt);
    World.__unstick && p && p.space === 'floor' && World.__unstick(p);
    world.update(dt);
    afterUpdate(dt);
  }

  function afterUpdate(dt) {
    Audio2.update(dt, world.tension || 0);
    var sp = world.player ? world.player.space : null;
    if (sp !== lastSpace) { lastSpace = sp; Render.layout(); }
    if (world.over) {
      over = true;
      UI.showEnd(world);
      if (world.reason === "caught") Audio2.catchSound();
      else Audio2.ding(0.6);
    }
  }

  /* ---------- 启动 ---------- */

  function firstGesture() {
    Audio2.init();
    Audio2.resume();
    window.removeEventListener("pointerdown", firstGesture);
    window.removeEventListener("keydown", firstGesture);
  }
  window.addEventListener("pointerdown", firstGesture);
  window.addEventListener("keydown", firstGesture);

  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyR" && over) restart();
    if (e.code === "Escape") { if (over) restart(); }
  });

  window.addEventListener("resize", function () {
    Render.resize();
    Render.layout();
  });
  window.addEventListener("orientationchange", function () {
    setTimeout(function () { Render.resize(); Render.layout(); }, 160);
  });

  function start() {
    Render.init(document.getElementById("stage"));
    Input.init(null);
    UI.init({
      resume: function () { paused = false; UI.showPause(false); },
      restart: function () { boot(); },
      pressCarFloor: function (f) { World.playerPressCarFloor(f); },
      openDoor: function () { World.playerToggleCarDoor(true); },
      closeDoor: function () { World.playerToggleCarDoor(false); },
      exitCar: function () { World.playerExitCar(); }
    });
    if ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0) document.body.classList.add("touch");
    boot();
  }

  window.EK2 = {
    get world() { return world; },
    boot: boot, restart: restart,
    resume: function () { paused = false; UI.showPause(false); },
    pressCarFloor: function (f) { World.playerPressCarFloor(f); },
    step: step,
    setPaused: function (v) { paused = !!v; UI.showPause(paused); },
    get paused() { return paused; }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(start, 0);
  } else {
    document.addEventListener("DOMContentLoaded", start);
  }
})();
