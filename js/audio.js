/* ============================================================
 * audio.js · 全部声音都是现场合成的（没有音频文件）
 * ------------------------------------------------------------
 * 底噪嗡鸣 / 脚步 / 推门 / 电梯铃 / 心跳 / 被抓 / 远处撞击
 * ============================================================ */
"use strict";

var Audio2 = (function () {
  var ctx = null, master = null, drone = null, noiseBuf = null;
  var bus = null, reverb = null, wet = null, reverbIn = null;
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

    /* 混响：用衰减噪声做一条 1.8 秒的脉冲响应，地下车库/楼道的感觉 */
    var irLen = Math.floor(ctx.sampleRate * 1.8);
    var ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var dch = ir.getChannelData(ch);
      for (var i = 0; i < irLen; i++) {
        var t = i / irLen;
        dch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - t * 0.2);
      }
    }
    reverb = ctx.createConvolver();
    reverb.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverb.connect(wet);
    wet.connect(master);
    master.dryGain = null;
    reverbIn = ctx.createGain();
    reverbIn.gain.value = 1;
    reverbIn.connect(reverb);
    /* 之后所有音效都汇到 bus（干声 + 混响） */
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(master);
    bus.connect(reverbIn);

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
    n.connect(bp); bp.connect(ng); ng.connect(bus);
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
    o.connect(g); g.connect(bus);
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
    s.connect(f); f.connect(g); g.connect(bus);
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
      o.connect(f); f.connect(g); g.connect(bus);
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
      o.connect(g); g.connect(bus);
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
    o.connect(f); f.connect(g); g.connect(bus);
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

  /* 耳语：两段带通噪声 + 慢速幅度摆动，听不清但让人不安 */
  function whisper(vol) {
    if (!ready || muted) return;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.55 + Math.random() * 0.3;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900 + Math.random() * 900;
    f.Q.value = 6;
    var g = ctx.createGain();
    var t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    var n = 3 + Math.floor(Math.random() * 4);
    for (var i = 0; i < n; i++) {
      g.gain.linearRampToValueAtTime((vol || 0.05) * (0.4 + Math.random() * 0.6), t0 + 0.12 + i * 0.16);
      g.gain.linearRampToValueAtTime(0.0005, t0 + 0.24 + i * 0.16);
    }
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t0); s.stop(t0 + 0.2 + n * 0.16 + 0.2);
  }

  /* 木头裂开 / 楼板响一声 */
  function creak(vol) {
    if (!ready || muted) return;
    var o = ctx.createOscillator();
    o.type = "sawtooth";
    var t0 = ctx.currentTime;
    o.frequency.setValueAtTime(60 + Math.random() * 40, t0);
    o.frequency.linearRampToValueAtTime(150 + Math.random() * 120, t0 + 0.9 + Math.random() * 0.5);
    var f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 700; f.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.05, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.2);
    o.connect(f); f.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 1.3);
  }

  /* 很远的脚步（闷、慢、带混响） */
  function farSteps(vol) {
    if (!ready || muted) return;
    var n = 2 + Math.floor(Math.random() * 3);
    for (var i = 0; i < n; i++) {
      (function (k) {
        setTimeout(function () { noiseBurst(0.1, (vol || 0.05) * (1 - k * 0.15), 130, 0.9); }, k * (420 + Math.random() * 220));
      })(i);
    }
  }

  /* 呼吸：紧张时自动出现，越快越急 */
  var breathT = 0;
  function breath(rate, vol) {
    if (!ready || muted) return;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.7;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 620;
    f.Q.value = 1.4;
    var g = ctx.createGain();
    var t0 = ctx.currentTime;
    var dur = Math.max(0.28, 1.5 - rate * 0.4);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.045, t0 + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  /* 金属管道被敲一下（很空、很长的回声） */
  function pipeKnock(vol) {
    if (!ready || muted) return;
    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(180 + Math.random() * 240, ctx.currentTime);
    var g = ctx.createGain();
    var t0 = ctx.currentTime;
    g.gain.setValueAtTime(vol || 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 1.6);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 1.7);
    noiseBurst(0.12, (vol || 0.05) * 0.8, 1200, 3);
  }

  /* 轿厢低频嗡鸣（坐电梯时），level 0~1 */
  var humGain = null, humOsc = null;
  function setCarHum(level) {
    if (!ready) return;
    if (!humGain) {
      humGain = ctx.createGain();
      humGain.gain.value = 0;
      humGain.connect(bus);
      humOsc = ctx.createOscillator();
      humOsc.type = "sawtooth";
      humOsc.frequency.value = 47;
      var f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 190;
      humOsc.connect(f); f.connect(humGain);
      humOsc.start();
      var o2 = ctx.createOscillator();
      o2.type = "sine"; o2.frequency.value = 94;
      var g2 = ctx.createGain(); g2.gain.value = 0.5;
      o2.connect(g2); g2.connect(humGain);
      o2.start();
    }
    humGain.gain.value = Math.max(0, Math.min(1, level)) * 0.05;
  }

  /* 拧螺丝/电火花：短促的电流噪声，反问自己"有人听见了吗" */
  function repair(vol) {
    if (!ready || muted) return;
    noiseBurst(0.09, 0.05 * (vol || 1), 2600, 4);
    var o = ctx.createOscillator();
    o.type = "square";
    var t0 = ctx.currentTime;
    o.frequency.setValueAtTime(120 + Math.random() * 60, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.03 * (vol || 1), t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.14);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 0.16);
  }

  /* 通电：低频冲击 + 一阵电流嗡鸣 */
  function powerOn() {
    if (!ready || muted) return;
    var o = ctx.createOscillator();
    o.type = "sawtooth";
    var t0 = ctx.currentTime;
    o.frequency.setValueAtTime(52, t0);
    o.frequency.linearRampToValueAtTime(96, t0 + 0.5);
    var f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.setValueAtTime(240, t0);
    f.frequency.linearRampToValueAtTime(1400, t0 + 0.55);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.09, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 1.4);
    o.connect(f); f.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 1.5);
    noiseBurst(0.3, 0.05, 1800, 2);
  }

  /* 受伤：闷响 + 耳鸣 */
  function hurt() {
    if (!ready || muted) return;
    noiseBurst(0.28, 0.18, 220, 1.2);
    var o = ctx.createOscillator();
    o.type = "sine";
    var t0 = ctx.currentTime;
    o.frequency.setValueAtTime(1500, t0);
    o.frequency.linearRampToValueAtTime(900, t0 + 1.6);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 1.8);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + 1.9);
  }

  /* ---------------- 环境音乐 ---------------- */
  var music = null;

  function startMusic() {
    if (!ready || music) return;
    /* 低频铺底：两个略微失谐的锯齿波，慢速滤波摆动 —— 一直有个"嗡嗡的不对劲" */
    var padGain = ctx.createGain();
    padGain.gain.value = 0.0001;
    padGain.connect(bus);

    var padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 210;
    padFilter.Q.value = 2.2;
    padFilter.connect(padGain);

    var oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = 55;            // A1
    var oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.frequency.value = 55 * 1.006;    // 轻微失谐 → 缓慢拍频
    var oscC = ctx.createOscillator();
    oscC.type = "sine";
    oscC.frequency.value = 27.5;          // 低八度
    var cg = ctx.createGain();
    cg.gain.value = 0.5;
    oscA.connect(padFilter);
    oscB.connect(padFilter);
    oscC.connect(cg); cg.connect(padGain);
    oscA.start(); oscB.start(); oscC.start();

    /* 滤波器慢摆（0.045 Hz） */
    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.045;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();

    /* 高频"风声"薄片 */
    var air = ctx.createBufferSource();
    air.buffer = noiseBuf;
    air.loop = true;
    var airF = ctx.createBiquadFilter();
    airF.type = "bandpass";
    airF.frequency.value = 1400;
    airF.Q.value = 0.6;
    var airG = ctx.createGain();
    airG.gain.value = 0.006;
    air.connect(airF); airF.connect(airG); airG.connect(bus);
    air.start();

    music = { pad: padGain, padFilter: padFilter, oscA: oscA, oscB: oscB, air: airG, root: 55 };

    /* 铺底音量随紧张度：平时几乎听不见，靠近它时慢慢压上来 */
    padGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    padGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 6);
  }

  /** 每帧把紧张度写进音乐（0~1） */
  function setMusicTension(t) {
    if (!ready || !music) return;
    var now = ctx.currentTime;
    music.pad.gain.setTargetAtTime(0.028 + t * 0.075, now, 0.9);
    music.padFilter.frequency.setTargetAtTime(200 + t * 300, now, 1.2);
    music.air.gain.setTargetAtTime(0.004 + t * 0.014, now, 1.0);
    /* 调式随紧张度往上顶半音（越慌越刺耳） */
    var rootTarget = t > 0.72 ? 58.27 : t > 0.4 ? 51.91 : 55;
    if (Math.abs(rootTarget - music.root) > 0.5) {
      music.root = rootTarget;
      music.oscA.frequency.setTargetAtTime(rootTarget, now, 2.5);
      music.oscB.frequency.setTargetAtTime(rootTarget * 1.006, now, 2.5);
    }
  }

  /** 八音盒式的走音旋律 —— 随机、稀疏、带延迟回声 */
  function motif(vol) {
    if (!ready || muted) return;
    var scale = [0, 3, 5, 7, 10, 12, 15];   // 小调五声 + 延伸
    var base = 220 * (Math.random() < 0.5 ? 1 : 0.5);
    var n = 3 + Math.floor(Math.random() * 4);
    var delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.29;
    var fb = ctx.createGain();
    fb.gain.value = 0.34;
    var dg = ctx.createGain();
    dg.gain.value = 0.5;
    delay.connect(fb); fb.connect(delay);
    delay.connect(dg); dg.connect(bus);
    var t0 = ctx.currentTime + 0.05;
    for (var i = 0; i < n; i++) {
      var o = ctx.createOscillator();
      o.type = "triangle";
      var semi = scale[Math.floor(Math.random() * scale.length)];
      o.frequency.value = base * Math.pow(2, semi / 12);
      var g = ctx.createGain();
      var at = t0 + i * (0.42 + Math.random() * 0.5);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime((vol || 0.05) * (0.6 + Math.random() * 0.4), at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0006, at + 1.5);
      o.connect(g); g.connect(bus); g.connect(delay);
      o.start(at); o.stop(at + 1.6);
    }
  }

  /** 被发现的瞬间：三全音上冲 + 低频撞击 */
  function stinger() {
    if (!ready || muted) return;
    var t0 = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.11, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 1.8);
    g.connect(bus);
    [1, 1.4142, 2.11].forEach(function (mul, k) {
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(90 * mul, t0);
      o.frequency.exponentialRampToValueAtTime(320 * mul, t0 + 0.5);
      var og = ctx.createGain();
      og.gain.value = 0.33 / (k + 1);
      o.connect(og); og.connect(g);
      o.start(t0); o.stop(t0 + 1.9);
    });
    noiseBurst(0.4, 0.16, 90, 0.8);
  }

  /** 突然的静默：所有声音被"抽走"一两秒 —— 比加声音更吓人 */
  function silenceDrop(sec) {
    if (!ready) return;
    var t0 = ctx.currentTime;
    var hold = sec || 1.4;
    bus.gain.cancelScheduledValues(t0);
    bus.gain.setValueAtTime(bus.gain.value, t0);
    bus.gain.linearRampToValueAtTime(0.0005, t0 + 0.06);
    bus.gain.setValueAtTime(0.0005, t0 + hold);
    bus.gain.linearRampToValueAtTime(1, t0 + hold + 0.9);
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
    /* 环境偶发声响：越紧张越密、越怪 */
    ambTimer -= dt;
    if (ambTimer <= 0) {
      ambTimer = (12 - tension * 7) + Math.random() * (10 - tension * 5);
      var r = Math.random();
      if (r < 0.34) distantClang();
      else if (r < 0.56) creak(0.035 + tension * 0.03);
      else if (r < 0.74) pipeKnock(0.03 + tension * 0.04);
      else if (r < 0.9) farSteps(0.035 + tension * 0.03);
      else whisper(0.03 + tension * 0.045);
    }

    /* 呼吸：紧张起来会听见自己喘 */
    if (tension > 0.3) {
      breathT -= dt;
      if (breathT <= 0) {
        breath(tension, 0.02 + tension * 0.05);
        breathT = (2.6 - tension * 1.4) * (0.85 + Math.random() * 0.4);
      }
    } else {
      breathT = Math.min(breathT, 0.8);
    }
  }

  return {
    init: init, resume: resume, update: update,
    footstep: footstep, door: door, ding: ding,
    catchSound: catchSound, scream: scream,
    whisper: whisper, creak: creak, farSteps: farSteps,
    pipeKnock: pipeKnock, breath: breath, setCarHum: setCarHum,
    repair: repair, powerOn: powerOn, hurt: hurt,
    startMusic: startMusic, setMusicTension: setMusicTension, motif: motif,
    stinger: stinger, silenceDrop: silenceDrop,
    setMute: function (v) { muted = v; if (master) master.gain.value = muted ? 0 : CFG.AUDIO.master; },
    get muted() { return muted; },
    get ready() { return ready; }
  };
})();
