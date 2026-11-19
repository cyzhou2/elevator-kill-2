/* ============================================================
 * audio.js · 全部声音都是现场合成的（没有音频文件）
 * ------------------------------------------------------------
 * 底噪嗡鸣 / 脚步 / 推门 / 电梯铃 / 心跳 / 被抓 / 远处撞击
 * ============================================================ */
"use strict";

var Audio2 = (function () {
  var ctx = null, master = null, drone = null, noiseBuf = null;
  var ready = false, muted = false;
  var heartTimer = 0, heartRate = 58, tension = 0;
  var ambTimer = 12;

  function init() {
    if (ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = CFG.AUDIO.master;
    master.connect(ctx.destination);

    /* 噪声缓冲（脚步/撞击都用它） */
    var len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);

    startDrone();
    ready = true;
  }

  function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }

  function startDrone() {
    drone = ctx.createGain();
    drone.gain.value = CFG.AUDIO.droneVol;
    drone.connect(master);

    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    lp.Q.value = 2.2;
    lp.connect(drone);

    [CFG.AUDIO.droneHz, CFG.AUDIO.droneHz * 1.007, CFG.AUDIO.droneHz * 2.02].forEach(function (hz, i) {
      var o = ctx.createOscillator();
      o.type = i === 2 ? "triangle" : "sawtooth";
      o.frequency.value = hz;
      var g = ctx.createGain();
      g.gain.value = i === 2 ? 0.22 : 0.5;
      o.connect(g); g.connect(lp);
      o.start();
      /* 极慢的失谐漂移 */
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      var lg = ctx.createGain();
      lg.gain.value = 1.2;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start();
    });

    /* 偶尔的电流噪声 */
    var n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true;
    var ng = ctx.createGain(); ng.gain.value = 0.012;
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.7;
    n.connect(bp); bp.connect(ng); ng.connect(master);
    n.start();
  }

  function boom(freq, dur, vol, type) {
    if (!ready || muted) return;
    var o = ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.45), ctx.currentTime + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.05);
  }

  function noiseBurst(dur, vol, freq, q) {
    if (!ready || muted) return;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q || 1.1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(); s.stop(ctx.currentTime + dur + 0.02);
  }

  function footstep(sprint, near) {
    if (!ready) return;
    var v = CFG.AUDIO.stepVol * (near ? 1 : 0.35) * (sprint ? 1.35 : 1);
    noiseBurst(0.09, v, 240 + Math.random() * 160, 1.4);
    if (sprint) boom(90, 0.08, v * 0.5, "sine");
  }

  function door(open) {
    if (!ready) return;
    if (open) {
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(320, ctx.currentTime + 0.28);
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1100;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + 0.5);
      noiseBurst(0.3, 0.05, 700, 2);
    } else {
      boom(150, 0.16, 0.16, "triangle");
      noiseBurst(0.1, 0.07, 500, 1.2);
    }
  }

  function ding(vol) {
    if (!ready) return;
    [1180, 1760].forEach(function (hz, i) {
      var o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = hz;
      var g = ctx.createGain();
      var t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.16 * (vol == null ? 1 : vol), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.1);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + 1.2);
    });
  }

  function catchSound() {
    if (!ready) return;
    noiseBurst(0.5, 0.5, 320, 0.7);
    boom(120, 0.9, 0.55, "sawtooth");
    boom(58, 1.4, 0.4, "sine");
  }

  function scream() {
    if (!ready) return;
    var o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(620, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.8);
    var f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 3;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + 0.9);
  }

  function distantClang() {
    if (!ready) return;
    noiseBurst(0.22, 0.05, 260 + Math.random() * 400, 3);
    boom(70 + Math.random() * 40, 0.7, 0.05, "sine");
  }

  function heartbeat(strength) {
    if (!ready) return;
    var v = CFG.AUDIO.heartVol * strength;
    boom(46, 0.16, v * 0.9, "sine");
    setTimeout(function () { boom(40, 0.2, v * 0.62, "sine"); }, 165);
  }

  function update(dt, tensionNow) {
    if (!ready) return;
    tension = tensionNow;
    /* 心率随紧张度上升 */
    var target = CFG.AUDIO.heartbeatBase + (CFG.AUDIO.heartbeatMax - CFG.AUDIO.heartbeatBase) * tension;
    heartRate += (target - heartRate) * Math.min(1, dt * 2);
    heartTimer -= dt;
    if (tension > 0.08 && heartTimer <= 0) {
      heartbeat(Math.min(1, 0.25 + tension));
      heartTimer = 60 / heartRate;
    } else if (tension <= 0.08) {
      heartTimer = 0;
    }
    /* 底噪随紧张度变厚 */
    if (drone) drone.gain.value = CFG.AUDIO.droneVol * (1 + tension * 1.6);
    /* 环境偶发声响 */
    ambTimer -= dt;
    if (ambTimer <= 0) { ambTimer = 9 + Math.random() * 16; distantClang(); }
  }

  return {
    init: init, resume: resume, update: update,
    footstep: footstep, door: door, ding: ding,
    catchSound: catchSound, scream: scream,
    setMute: function (v) { muted = v; if (master) master.gain.value = muted ? 0 : CFG.AUDIO.master; },
    get muted() { return muted; },
    get ready() { return ready; }
  };
})();
