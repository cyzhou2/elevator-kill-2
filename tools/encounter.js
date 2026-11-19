const fs = require("fs"), vm = require("vm");
const FILES = ["js/config.js", "js/geom.js", "js/world.js", "js/ai.js"];
const sb = { console, Math, Date, JSON, Set, Map, isFinite, parseFloat, parseInt, window: {}, setTimeout };
sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: f });
const W = sb.World; W.init(sb.CFG); const w = W.state; const dt = 1 / 60;

let chases = 0, minDist = {}, sight = 0, frames = 0;
let elevLog = [];
const prevState = {};
for (let i = 0; i < 10800; i++) {
  W.update(dt);
  frames++;
  for (const k of w.actors) {
    if (k.kind !== "killer" || !k.alive) continue;
    if (k.state === "chase" && prevState[k.id] !== "chase") chases++;
    prevState[k.id] = k.state;
  }
  for (const e of w.elevators) {
    const key = e.id;
    if (!prevState["e" + key]) prevState["e" + key] = e.state + "@" + e.floor.toFixed(1);
    const cur = e.state + "@" + e.floor.toFixed(1);
    if (prevState["e" + key] !== cur && elevLog.length < 40) {
      elevLog.push((w.time).toFixed(1) + "s " + key + " " + cur);
      prevState["e" + key] = cur;
    }
  }
  /* 最近距离 */
  for (const k of w.actors) {
    if (k.kind !== "killer" || !k.alive) continue;
    for (const kid of w.actors) {
      if (kid.kind !== "kid" || !kid.alive || kid.space !== "floor") continue;
      if (kid.floor !== k.floor) continue;
      const d = W.dist(k.x, k.y, kid.x, kid.y);
      const mk = k.id + ">" + kid.id;
      if (!(minDist[mk] <= d)) minDist[mk] = d;
      if (d < 8 && W.los(k.floor, k.x, k.y, kid.x, kid.y)) sight++;
    }
  }
}
console.log("chase 次数", chases, "| 同层可见帧", sight, "/", frames);
console.log("各配对最近距离", Object.entries(minDist).map(([k, v]) => k + ":" + v.toFixed(2)).join(" "));
console.log("电梯前 20 次变化:\n" + elevLog.slice(0, 20).join("\n"));
