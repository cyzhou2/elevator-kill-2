/* ============================================================
 * ui.js · HUD / 轿厢面板 / 提示 / 结算
 * ============================================================ */
"use strict";

var UI = (function () {
  var el = {};
  var game = null;
  var lastHint = "", lastPanel = false, lastFloorTxt = "", lastCallPanel = false, lastStairPanel = false, lastCarPad = false;

  function $(id) { return document.getElementById(id); }

  function init(g) {
    game = g;
    ["clock", "floorNo", "aliveNo", "hint", "objPanel", "objCount", "objLives", "objFloors", "objTask",
      "repairBar", "rbFill", "rbLabel", "carPanel", "carPanelTitle", "carFloors",
      "carExit", "callPanel", "cpReadC", "cpReadD", "cpUp", "cpDown", "stairPanel", "stUp", "stDown", "carPad", "carActs",
      "overlay", "overlayCard",
      "pause", "pauseResume", "pauseRestart", "joy", "knob", "staminaBar", "flashMsg"].forEach(function (k) {
      el[k] = $(k);
    });

    buildCarPanel();

    if (el.pauseResume) el.pauseResume.onclick = function () { game.resume(); };
    if (el.pauseRestart) el.pauseRestart.onclick = function () { game.restart(); };
    if (el.carExit) el.carExit.onclick = function () { game.exitCar && game.exitCar(); };
    var carActs = document.querySelectorAll("[data-cact]");
    carActs.forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.dataset.cact;
        if (a === "open") game.openDoor && game.openDoor();
        else if (a === "close") game.closeDoor && game.closeDoor();
        else if (a === "exit") game.exitCar && game.exitCar();
      });
    });
    if (el.cpUp) el.cpUp.onclick = function () { game.callUp && game.callUp(); };
    if (el.stUp) el.stUp.onclick = function () { game.stairUp && game.stairUp(); };
    if (el.stDown) el.stDown.onclick = function () { game.stairDown && game.stairDown(); };
    if (el.cpDown) el.cpDown.onclick = function () { game.callDown && game.callDown(); };
  }

  function buildCarPanel() {
    if (!el.carFloors) return;
    var html = "";
    /* 20..1 两两一行，共 10 行 */
    for (var f = CFG.FLOORS; f >= 1; f -= 2) {
      html += '<button class="cf" data-floor="' + f + '">' + f + "</button>";
      var g = f - 1;
      if (g >= 1) html += '<button class="cf" data-floor="' + g + '">' + g + "</button>";
      else html += '<span></span>';
    }
    /* 第 11 行：开门 / 关门（图标） */
    html += '<button class="cDoor" data-door="open" title="开门"><span class="dooricon">&#9664;<i></i>&#9654;</span></button>';
    html += '<button class="cDoor" data-door="close" title="关门"><span class="dooricon">&#9654;<i></i>&#9664;</span></button>';
    el.carFloors.innerHTML = html;
    el.carFloors.querySelectorAll(".cf").forEach(function (b) {
      b.addEventListener("click", function () {
        game.pressCarFloor(parseInt(b.dataset.floor, 10));
      });
    });
    el.carFloors.querySelectorAll(".cDoor").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.door === "open") game.openDoor && game.openDoor();
        else game.closeDoor && game.closeDoor();
      });
    });
  }

  /* 电梯读数：楼层 + 方向（面板只在附近出现，所以看得到就是真的） */
  function carRead(w, id) {
    var e = w.carById(id);
    if (!e) return { text: "--", cls: "" };
    var f = Math.round(e.floor);
    var atInt = Math.abs(e.floor - f) < 0.06;
    var here = atInt && Math.abs(f - w.player.floor) < 0.06;
    if (here && e.doorsOpen) return { text: f + "F · 开门", cls: "" };
    if (here && atInt) return { text: f + "F · 本层", cls: "" };
    var dir = e.state === "moving" ? (e.dir > 0 ? "▲" : e.dir < 0 ? "▼" : "") : "";
    return { text: f + "F " + dir, cls: e.dir > 0 ? "up" : e.dir < 0 ? "dn" : "" };
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function update(world, dt) {
    var W = world;
    if (!W.player) return;

    if (el.clock) el.clock.textContent = fmtTime(CFG.ROUND_SEC - Math.min(W.time, CFG.ROUND_SEC));
    if (el.aliveNo) el.aliveNo.textContent = W.countAliveKids();

    /* 楼层：在轿厢里显示车所在层 */
    var floorNo = W.player.space === "car" ? Math.round((W.carById(W.player.carId) || {}).floor || 1) : W.player.floor;
    var ftxt = floorNo + "F" + (W.player.space === "car" ? " · 轿厢内" : "");
    if (ftxt !== lastFloorTxt && el.floorNo) { el.floorNo.textContent = ftxt; lastFloorTxt = ftxt; }

    /* 体力 */
    if (el.staminaBar) {
      var pct = Math.max(0, Math.min(1, W.player.stamina / CFG.KID.stamina));
      el.staminaBar.style.width = (pct * 100).toFixed(1) + "%";
      el.staminaBar.style.opacity = pct < 0.99 ? "1" : "0.25";
      el.staminaBar.style.background = pct < 0.25 ? "#b33a3a" : "#7fa0a8";
    }

    /* 轿厢面板 */
    var inCar = W.player.space === "car";
    if (inCar !== lastPanel) {
      lastPanel = inCar;
      el.carPanel.classList.toggle("hidden", !inCar);
      document.body.classList.toggle("in-car", inCar);
    }
    if (inCar) {
      var e = W.carById(W.player.carId);
      if (e) {
        el.carPanelTitle.textContent = e.id + " 梯 · " + Math.round(e.floor) + "F" + (e.dir > 0 ? " ▲" : e.dir < 0 ? " ▼" : "");
        var btns = el.carFloors.querySelectorAll(".cf");
        for (var i = 0; i < btns.length; i++) {
          var f = parseInt(btns[i].dataset.floor, 10);
          btns[i].classList.toggle("lit", e.calls.has(f));
          btns[i].classList.toggle("here", Math.round(e.floor) === f);
        }
      }
    }

    /* 目标面板 */
    updateObjectives(W);

    /* 轿厢内方向键 */
    var showPad = !!(W.player && W.player.space === "car");
    if (showPad !== lastCarPad) {
      lastCarPad = showPad;
      el.carPad.classList.toggle("hidden", !showPad);
      if (el.carActs) el.carActs.classList.toggle("hidden", !showPad);
      document.body.classList.toggle("inCar", showPad);
    }

    /* 楼梯面板（走到楼梯口才出现） */
    var showStair = !!(W.nearStairs && W.nearStairs());
    if (showStair !== lastStairPanel) {
      lastStairPanel = showStair;
      el.stairPanel.classList.toggle("hidden", !showStair);
    }
    if (showStair) {
      el.stUp.disabled = W.player.floor >= CFG.FLOORS;
      el.stDown.disabled = W.player.floor <= 1;
    }

    /* 呼梯面板 */
    var showPanel = !!(W.panelVisible && W.panelVisible());
    if (showPanel !== lastCallPanel) {
      lastCallPanel = showPanel;
      el.callPanel.classList.toggle("hidden", !showPanel);
    }
    if (showPanel) {
      var rc = carRead(W, "C"), rd = carRead(W, "D");
      el.cpReadC.innerHTML = '<span class="' + rc.cls + '">' + rc.text + "</span>";
      el.cpReadD.innerHTML = '<span class="' + rd.cls + '">' + rd.text + "</span>";
      var fl = W.player.floor;
      el.cpUp.classList.toggle("lit", !!W.hallUp[fl]);
      el.cpDown.classList.toggle("lit", !!W.hallDown[fl]);
      el.cpUp.disabled = !W.canCall(1);
      el.cpDown.disabled = !W.canCall(-1);
    }

    /* 提示 */
    var hint = hintFor(W);
    if (hint !== lastHint) {
      lastHint = hint;
      el.hint.innerHTML = hint;
      el.hint.classList.toggle("show", !!hint);
    }
  }

  /* ---------- 目标面板 / 读条 ---------- */
  var lastObjKey = "", lastBarKey = "";
  function updateObjectives(W) {
    var p = W.player;
    if (!el.objPanel) return;
    var done = W.fusesDone || 0;
    var total = W.fuseTotal || (W.fuses ? W.fuses.length : 0);
    var key = done + "/" + total + "|" + W.lives + "|" + (p ? p.floor : 0) + "|" + (W.allFusesDone && W.allFusesDone() ? 1 : 0);
    if (key !== lastObjKey) {
      lastObjKey = key;
      el.objCount.textContent = done + "/" + total;
      el.objLives.textContent = new Array(Math.max(0, W.lives || 0) + 1).join("♥") || "—";
      var html = "";
      (W.fuses || []).forEach(function (f) {
        var cls = f.done ? "done" : (p && f.floor === p.floor ? "here" : "");
        html += '<span class="' + cls + '">' + f.floor + "F</span>";
      });
      el.objFloors.innerHTML = html;
      if (W.allFusesDone && W.allFusesDone()) {
        el.objTask.textContent = p && p.floor === 1 ? "去大厅按紧急按钮出门" : "回 1F 大厅，按紧急按钮";
        el.objTask.className = "objTask ready";
      } else {
        el.objTask.textContent = "修好 " + total + " 处配电箱（站到箱子旁按 用）";
        el.objTask.className = "objTask";
      }
    }

    /* 修理读条 */
    var rp = W.repair;
    var showBar = !!(rp && p && p.space === "floor");
    var bkey = showBar ? Math.round((W.fuses[rp.index].prog || 0) * 100) + "" : "off";
    if (bkey !== lastBarKey) {
      lastBarKey = bkey;
      if (el.repairBar) el.repairBar.classList.toggle("hidden", !showBar);
      if (showBar && el.rbFill) {
        el.rbFill.style.width = Math.round((W.fuses[rp.index].prog || 0) * 100) + "%";
        el.rbLabel.textContent = "修理中… 别停下";
      }
    }
  }

  function hintFor(W) {
    var p = W.player;
    if (!p.alive) return "";
    if (p.space === "stair") return "楼梯上…";
    if (p.space === "car") return "左下方向键走动 · 右侧选层 · 右下 <b>出</b> 出门";
    if (W.allFusesDone && W.allFusesDone() && W.nearExit && W.nearExit()) return "按 <b>用</b> / 点面板 —— 按下紧急按钮离开";
    if (W.repair) return "修理中… 离开就中断（进度会保留）";
    if (W.nearFuse && W.nearFuse()) return "按 <b>用</b> 修配电箱 · 声音会招来它";
    var g = W.geom;
    if (W.nearStairs && W.nearStairs()) return "楼梯间 · <b>E</b> 上楼 · <b>Q</b> 下楼";
    if (W.nearDoor && W.nearDoor()) {
      var L = W.nearDoor();
      var d = W.state.stairDoors[p.floor][L];
      return d.open ? "<b>E</b> 把门带上（挡视线）" : "<b>E</b> 推开楼梯间的门";
    }
    if (Geom.inRect(g.hall, p.x, p.y, -0.05)) {
      var open = W.elevAt(p.floor).filter(function (e) { return e.doorsOpen; });
      if (open.length) return "门开着 · 走进轿厢";
      return "点面板 ▲/▼ 呼梯 · <b>E</b> 上 / <b>Q</b> 下";
    }
    return "";
  }

  function toast(text) {
    if (!el.flashMsg) return;
    el.flashMsg.textContent = text;
    el.flashMsg.classList.add("show");
    clearTimeout(el.flashMsg._t);
    el.flashMsg._t = setTimeout(function () { el.flashMsg.classList.remove("show"); }, 1600);
  }

  function showEnd(W) {
    var me = W.player;
    var escape = W.reason === "escape";
    var caught = W.reason === "caught" || W.reason === "allcaught";
    var timeUp = W.reason === "time";
    var title = escape ? "你 出 去 了" : caught ? "连 接 中 断" : timeUp ? "天 亮 了" : "全 员 失 联";
    var sub = escape
      ? "在 " + fmtTime(W.time) + " 修好 " + (W.fusesDone || 0) + "/" + (W.fuseTotal || 0) + " 处配电箱，从 1F 走了出去"
      : caught
        ? "你在 " + me.floor + "F 被抓住了 · 修好 " + (W.fusesDone || 0) + "/" + (W.fuseTotal || 0)
        : timeUp
          ? "没能在天亮前修完 · 修好 " + (W.fusesDone || 0) + "/" + (W.fuseTotal || 0)
          : "孩子们都失联了";
    var score = W.score || Math.round(W.time * CFG.SCORE.perSecond);
    el.overlayCard.innerHTML =
      '<div class="endTitle' + (escape ? "" : " red") + '">' + title + "</div>" +
      '<div class="endSub">' + sub + "</div>" +
      '<div class="endScore">' + score + "</div>" +
      '<div class="endUnit">' + (escape ? "逃生分" : "分") + "</div>" +
      '<div class="endBtns"><button id="againBtn" class="btn primary">再来一次</button></div>' +
      '<div class="endFoot">按 R 重新开始</div>';
    el.overlay.classList.remove("hidden");
    var b = document.getElementById("againBtn");
    if (b) b.onclick = function () { game.restart(); };
  }

  function hideEnd() { el.overlay.classList.add("hidden"); }

  function showPause(v) {
    el.pause.classList.toggle("hidden", !v);
  }

  return {
    init: init, update: update, toast: toast,
    showEnd: showEnd, hideEnd: hideEnd, showPause: showPause,
    fmtTime: fmtTime
  };
})();
