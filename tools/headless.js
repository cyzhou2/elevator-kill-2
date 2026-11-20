/* 无头跑局：node tools/headless.js [秒数] [小孩] [杀人犯] [种子]
 * 只加载逻辑模块（不含 DOM / 渲染 / 音频），用来验证规则与 AI。 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = ["js/config.js", "js/geom.js", "js/nav.js", "js/world.js", "js/ai.js"];

function makeWorld(over, seed) {
  let s = seed || 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const sandbox = {
    console, Math: Object.create(Math), Date, JSON, Set, Map, isFinite, parseFloat, parseInt,
    window: {}, setTimeout
  };
  sandbox.Math.random = rnd;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
  const EK = sandbox;
  EK.CFG = Object.assign({}, EK.CFG, over || {});
  return { World: EK.World, CFG: EK.CFG, AI: EK.AI };
}

function run(sec, over, seed) {
  const { World, CFG } = makeWorld(over, seed || 7);
  const w = World.init(CFG);
  const dt = 1 / 60;
  const steps = Math.floor(sec / dt);
  let stuck = 0, lastPos = {}, rides = 0, doorsOpened = 0, wasCar = {};
  for (let i = 0; i < steps; i++) {
    World.update(dt);
    if (w.over) break;
    for (const a of w.actors) {
      if (!a.alive) continue;
      const key = a.id;
      const p = lastPos[key];
      if (a.space === "floor" && p && Math.abs(a.x - p.x) < 1e-4 && Math.abs(a.y - p.y) < 1e-4) stuck++;
      lastPos[key] = { x: a.x, y: a.y, f: a.floor };
      const inCar = a.space === "car";
      if (inCar && !wasCar[key]) rides++;
      wasCar[key] = inCar;
    }
  }
  return {
    time: +w.time.toFixed(1), kills: w.kills, alive: World.countAliveKids(),
    over: w.over, reason: w.reason, stuck, rides,
    events: w.events.length,
    elev: w.elevators.map(e => ({ id: e.id, floor: +e.floor.toFixed(1), state: e.state }))
  };
}

const sec = parseFloat(process.argv[2] || "120");
const kids = parseInt(process.argv[3] || "3", 10);
const killers = parseInt(process.argv[4] || "2", 10);
const seed = parseInt(process.argv[5] || "7", 10);

let agg = { kills: 0, alive: 0, stuck: 0, rides: 0, n: 0 };
const N = 6;
for (let i = 0; i < N; i++) {
  const r = run(sec, { KIDS: kids, KILLERS: killers }, seed + i * 977);
  agg.kills += r.kills; agg.alive += r.alive; agg.stuck += r.stuck; agg.rides += r.rides; agg.n++;
  if (i === 0) console.log("单局样本:", JSON.stringify(r));
}
console.log(`--- ${N} 局 · ${sec}s · 小孩${kids}/杀人犯${killers} ---`);
console.log("平均抓捕", (agg.kills / agg.n).toFixed(2), "| 平均存活", (agg.alive / agg.n).toFixed(2),
  "| 停滞帧", agg.stuck, "| 平均坐梯", (agg.rides / agg.n).toFixed(2));
