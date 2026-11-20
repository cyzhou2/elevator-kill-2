/* ============================================================
 * input.js · 键鼠 + 触屏
 * ------------------------------------------------------------
 * 键盘：WASD/方向键移动，Shift 冲刺，E 互动（推门/呼梯），
 *       楼梯间里 W/S = 上/下楼；轿厢里 E 开门 / Q 关门 / Space 出梯
 * 鼠标：点地面走过去，点门推门，点呼梯按钮呼梯，点楼梯上下楼
 * 触屏：左下摇杆 + 右下四个键
 * ============================================================ */
"use strict";

var Input = (function () {
  var move = { x: 0, y: 0 };
  var sprint = false;
  var actions = [];
  var keys = {};
  var joy = { active: false, dx: 0, dy: 0, id: null, cx: 0, cy: 0 };
  var clickTarget = null;     // 世界坐标，用于「点哪走哪」
  var padOn = { up: false, down: false, left: false, right: false };  // 轿厢内屏幕方向键
  var els = {};

  function push(a) { actions.push(a); }

  function init(game) {
    els.stage = document.getElementById("stage");
    els.joy = document.getElementById("joy");
    els.knob = document.getElementById("knob");

    /* 键盘 */
    window.addEventListener("keydown", function (e) {
      if (e.repeat) {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
        return;
      }
      keys[e.code] = true;
      switch (e.code) {
        case "KeyE": push("interact"); e.preventDefault(); break;
        case "KeyQ": push("interactDown"); e.preventDefault(); break;
        case "Space": push("space"); e.preventDefault(); break;
        case "Escape": push("pause"); break;
        case "KeyM": push("mute"); break;
        case "KeyF": push("light"); break;
      }
    });
    window.addEventListener("keyup", function (e) { keys[e.code] = false; });

    /* 鼠标点世界 */
    els.stage.addEventListener("click", function (e) {
      var r = els.stage.getBoundingClientRect();
      var p = Render.toWorld(e.clientX - r.left, e.clientY - r.top);
      clickTarget = p;
      push({ click: p, raw: { x: e.clientX - r.left, y: e.clientY - r.top } });
    });

    /* 轿厢内方向键（鼠标/触屏都能按） */
    var padBtns = document.querySelectorAll("[data-cm]");
    padBtns.forEach(function (b) {
      var dir = b.dataset.cm;
      if (!(dir in padOn)) return;
      var set = function (on) {
        padOn[dir] = on;
        b.classList.toggle("on", on);
      };
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); set(true); });
      b.addEventListener("pointerup", function () { set(false); });
      b.addEventListener("pointerleave", function () { set(false); });
      b.addEventListener("pointercancel", function () { set(false); });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });

    /* 触屏摇杆 */
    if (els.joy) {
      var start = function (e) {
        joy.active = true; joy.id = e.pointerId;
        var r = els.joy.getBoundingClientRect();
        joy.cx = r.left + r.width / 2;
        joy.cy = r.top + r.height / 2;
        try { els.joy.setPointerCapture(e.pointerId); } catch (_) { }
        moveJoy(e.clientX, e.clientY);
      };
      var moveJoy = function (cx, cy) {
        var dx = cx - joy.cx, dy = cy - joy.cy;
        var max = 46;
        var d = Math.hypot(dx, dy);
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        joy.dx = dx / max; joy.dy = dy / max;
        if (els.knob) els.knob.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
      };
      els.joy.addEventListener("pointerdown", function (e) { e.preventDefault(); start(e); });
      els.joy.addEventListener("pointermove", function (e) {
        if (!joy.active || e.pointerId !== joy.id) return;
        e.preventDefault();
        moveJoy(e.clientX, e.clientY);
      });
      var end = function (e) {
        if (e.pointerId !== joy.id) return;
        joy.active = false; joy.dx = joy.dy = 0;
        if (els.knob) els.knob.style.transform = "translate(0,0)";
      };
      els.joy.addEventListener("pointerup", end);
      els.joy.addEventListener("pointercancel", end);
    }

    /* 触屏按钮 */
    document.querySelectorAll("[data-act]").forEach(function (btn) {
      var act = btn.dataset.act;
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        btn.classList.add("on");
        if (act === "sprint") sprint = true;
        else push(act);
      });
      var up = function (e) {
        if (e) e.preventDefault();
        btn.classList.remove("on");
        if (act === "sprint") sprint = false;
      };
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });

    window.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function poll() {
    var x = 0, y = 0;
    if (keys["KeyA"] || keys["ArrowLeft"]) x -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) x += 1;
    if (keys["KeyW"] || keys["ArrowUp"]) y -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) y += 1;
    if (joy.active) { x += joy.dx; y += joy.dy; }
    if (padOn.left) x -= 1;
    if (padOn.right) x += 1;
    if (padOn.up) y -= 1;
    if (padOn.down) y += 1;
    var sp = sprint || !!(keys["ShiftLeft"] || keys["ShiftRight"]);
    return { x: x, y: y, sprint: sp };
  }

  function consume() {
    var a = actions;
    actions = [];
    return a;
  }

  function clearClick() { clickTarget = null; }

  return {
    init: init, poll: poll, consume: consume,
    get clickTarget() { return clickTarget; },
    clearClick: clearClick,
    get joystick() { return joy; }
  };
})();
