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
  var walkPath = [];
  var pendingCall = null;
  var pendingDoor = null;
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

  /* 多段路点：比如「先走到门前 → 再穿过去 → 再到楼梯口」 */
  function setWalk(points) {
    walkPath = points.slice();
    walkTarget = walkPath.length ? walkPath[0] : null;
  }

  /* ---------- 动作 ---------- */

  function doAction(a) {
    var p = world.player;
    if (!p || !p.alive || over) return;
    if (p.space === "stair") return;

    var inStairZone = p.space === "floor" && World.nearStairs();

    if (a === "interact") {
      if (p.space === "car") { World.playerToggleCarDoor(true); return; }
      if (inStairZone) { World.playerTryStairs(1); return; }          // E = 上楼
      if (World.nearDoor()) { World.playerToggleDoor(); return; }
      if (World.boardOpenCar && World.boardOpenCar()) return;  // 门开着就进梯
      if (world.panelVisible()) World.playerCallElevator(1);
      return;
    }
    if (a === "interactDown") {
      if (p.space === "car") { World.playerToggleCarDoor(false); return; }
      if (inStairZone) { World.playerTryStairs(-1); return; }          // Q = 下楼
      if (world.panelVisible()) World.playerCallElevator(-1);
      return;
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

  /** 叫离你最近的一部梯（只有呼梯面板显示时才允许） */
  function callNearestCar() {
    var p = world.player;
    var best = null, bf = 1e9;
    for (var i = 0; i < world.elevators.length; i++) {
      var e = world.elevators[i];
      var d = Math.abs(e.floor - p.floor) + (e.state === "moving" ? 0.5 : 0);
      if (d < bf) { bf = d; best = e; }
    }
    if (best) World.playerCallElevator(best.id);
  }

  function stairUp() { World.playerTryStairs(1); }
  function stairDown() { World.playerTryStairs(-1); }
  function callUp() { World.playerCallElevator(1); }
  function callDown() { World.playerCallElevator(-1); }

  function togglePause() {
    if (over) return;
    paused = !paused;
    UI.showPause(paused);
  }

  function onStageClick(raw, pt) {
    var p = world.player;
    if (!p || !p.alive || over) return;

    /* 交互图标优先：点它就等于"按住"那个动作 */
    if (p.space === "floor") {
      var pr = hitPrompt(raw);
      if (pr) {
        World.promptAction(pr.kind, pr.id);
        return;
      }
    }
    /* 轿厢场景：点轿厢内部 = 走过去（手机靠这个移动） */
    if (p.space === "car") {
      var cw = Render.carToWorld(raw.x, raw.y);
      if (cw) setWalk([cw]);
      return;
    }
    handleClick(pt);
  }

  /** 点到交互图标了吗（屏幕坐标） */
  function hitPrompt(raw) {
    var list = World.prompts ? World.prompts() : [];
    for (var i = 0; i < list.length; i++) {
      var pr = list[i];
      var s = Render.w2s(pr.x, pr.y);
      var d = Math.hypot(raw.x - s.x, raw.y - s.y);
      if (d <= 26) return pr;
    }
    return null;
  }

  function handleClick(pt) {
    var p = world.player;
    if (!p || !p.alive || over) return;
    if (p.space === "stair") return;

    var g = world.geom;

    /* 轿厢里：点下半部分（门）就出去 */
    if (p.space === "car") {
      var cv = $("#stage").getBoundingClientRect();
      if (pt.y < 0) return;                       // 轿厢场景另算，见 stage 点击
      return;
    }

    /* 点电梯井 / 轿厢：开着就进去，关着就走到门口 */
    for (var i = 0; i < world.elevators.length; i++) {
      var e = world.elevators[i];
      var car = e.id === "C" ? g.elev.C.car : g.elev.D.car;
      var inCarArea = pt.y < g.hallY0 - 0.05 && pt.x > car.x - 0.25 && pt.x < car.x + car.w + 0.25;
      if (!inCarArea) continue;
      if (e.doorsOpen && Math.abs(e.floor - p.floor) < 0.06) {
        var navCar = World.navFind(p, { x: e.cx, y: g.hallY0 - 0.15 }) || [];
        setWalk(navCar.concat([{ x: e.cx, y: g.hallY0 - 0.15 }, { x: e.cx, y: car.y + car.h * 0.55 }]));
      } else if (Geom.inRect(g.hall, p.x, p.y, 0.35)) {
        World.playerCallElevator(1);
      } else {
        setWalk([{ x: g.hallCX, y: g.hallY0 + 1.0 }]);
      }
      return;
    }

    /* 楼梯间门 */
    var dA = g.stairDoorA.rect, dB = g.stairDoorB.rect;
    if (World.dist(pt.x, pt.y, dA.x + dA.w / 2, dA.y + dA.h / 2) < 0.85 ||
      World.dist(pt.x, pt.y, dB.x + dB.w / 2, dB.y + dB.h / 2) < 0.85) {
      var L0 = World.dist(pt.x, pt.y, dA.x, dA.y) < World.dist(pt.x, pt.y, dB.x, dB.y) ? "A" : "B";
      var dr0 = L0 === "A" ? dA : dB;
      var front = { x: L0 === "A" ? dr0.x + dr0.w + 0.6 : dr0.x - 0.6, y: dr0.y + dr0.h / 2 };
      if (World.dist(p.x, p.y, front.x, front.y) > 0.7) {
        setWalk([{ x: front.x, y: front.y }]);
        pendingDoor = L0;
      } else {
        World.playerToggleDoor();
      }
      return;
    }

    /* 楼梯段：自动走过去、推门、再到楼梯口 */
    if (Geom.inRect(g.stairZoneA, pt.x, pt.y, 0) || Geom.inRect(g.stairZoneB, pt.x, pt.y, 0)) {
      if (World.nearStairs()) {
        World.playerTryStairs(pt.y < g.stairZoneA.y + g.stairZoneA.h / 2 ? 1 : -1);
      } else {
        var useA = Geom.inRect(g.stairZoneA, pt.x, pt.y, 0);
        var dr = useA ? g.stairDoorA.rect : g.stairDoorB.rect;
        var cy = dr.y + dr.h / 2;
        var sign = useA ? 1 : -1;
        var front2 = { x: dr.x + dr.w / 2 + sign * 0.75, y: cy };
        var gap = { x: dr.x + dr.w / 2, y: cy };
        var inside = { x: dr.x + dr.w / 2 - sign * 0.95, y: cy };
        var navTo = World.navFind(p, front2) || [{ x: front2.x, y: front2.y }];
        setWalk(navTo.concat([gap, inside, { x: pt.x, y: g.stairZoneA.y + 0.6 }]));
        pendingDoor = useA ? "A" : "B";
      }
      return;
    }

    /* 平地：寻路走过去 */
    setWalk(World.navFind(p, pt) || [{ x: pt.x, y: pt.y }]);
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
      else if (acts[i] && acts[i].click) onStageClick(acts[i].raw || { x: 0, y: 0 }, acts[i].click);
    }
    if (over) return;

    var mv = Input.poll();
    var p = world.player;

    /* 点地走路 */
    var dx = mv.x, dy = mv.y, sprint = mv.sprint;
    if (pendingDoor) {
      var gd = world.geom;
      var dd = pendingDoor === "A" ? gd.stairDoorA.rect : gd.stairDoorB.rect;
      var fp = { x: pendingDoor === "A" ? dd.x + dd.w + 0.6 : dd.x - 0.6, y: dd.y + dd.h / 2 };
      if (World.dist(p.x, p.y, fp.x, fp.y) < 0.5) {
        if (!world.state.stairDoors[p.floor][pendingDoor].open) World.playerToggleDoor();
        pendingDoor = null;
      }
    }
    if (pendingCall && Geom.inRect(world.geom.hall, p.x, p.y, 0.2)) {
      World.playerCallElevator(pendingCall);
      pendingCall = null;
    }
    World.autoOpenDoor(p);
    if (!walkTarget && walkPath.length) walkTarget = walkPath[0];
    if (walkTarget) {
      var ddx = walkTarget.x - p.x, ddy = walkTarget.y - p.y;
      var d = Math.hypot(ddx, ddy);
      if (d < 0.2) {
        walkPath.shift();
        walkTarget = walkPath.length ? walkPath[0] : null;
        ddx = walkTarget ? walkTarget.x - p.x : 0;
        ddy = walkTarget ? walkTarget.y - p.y : 0;
        d = walkTarget ? Math.hypot(ddx, ddy) : 0;
      }
      if (Math.abs(mv.x) > 0.3 || Math.abs(mv.y) > 0.3) { walkPath = []; walkTarget = null; }
      else if (walkTarget) { dx = ddx / d; dy = ddy / d; sprint = d > 3 && p.stamina > 30; }
    }

    if (p && p.alive) World.playerMoveAxis(dx, dy, sprint, dt);
    World.__unstick && p && p.space === 'floor' && World.__unstick(p);
    world.update(dt);
    afterUpdate(dt);
  }

  function afterUpdate(dt) {
    Audio2.update(dt, world.tension || 0);
    Audio2.setMusicTension(world.tension || 0);
    /* 轿厢低频嗡鸣 */
    var pl = world.player;
    if (pl && pl.space === "car") {
      var ce = world.carById(pl.carId);
      Audio2.setCarHum(ce && Math.abs(ce.floor - Math.round(ce.floor)) > 0.02 ? 1 : 0.45);
    } else {
      Audio2.setCarHum(0);
    }
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
    var bootMusic = function () {
      Audio2.resume && Audio2.resume();
      Audio2.startMusic && Audio2.startMusic();
      window.removeEventListener("pointerdown", bootMusic);
      window.removeEventListener("keydown", bootMusic);
    };
    window.addEventListener("pointerdown", bootMusic);
    window.addEventListener("keydown", bootMusic);

    Render.init(document.getElementById("stage"));
    Input.init(null);
    UI.init({
      resume: function () { paused = false; UI.showPause(false); },
      restart: function () { boot(); },
      pressCarFloor: function (f) { World.playerPressCarFloor(f); },
    stairUp: stairUp, stairDown: stairDown, callUp: callUp, callDown: callDown,
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
