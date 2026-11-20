const fs = require("fs"), vm = require("vm");
const FILES = ["js/config.js", "js/geom.js", "js/nav.js", "js/world.js", "js/ai.js"];
const sb = { console, Math, Date, JSON, Set, Map, isFinite, parseFloat, parseInt, window: {}, setTimeout };
sb.globalThis = sb; vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: f });
const W = sb.World; W.init(sb.CFG); const w = W.state; const dt = 1 / 60;
const AT = parseInt(process.argv[2] || "900", 10);
for (let i = 0; i < AT; i++) W.update(dt);
for (const a of w.actors) {
  const r = a.kind === "kid" ? 0.22 : 0.26;
  console.log(a.id, "space", a.space, "floor", a.floor, "pos", a.x.toFixed(3), a.y.toFixed(3),
    "canStand", a.space === "floor" ? W.canStand(a.floor, a.x, a.y, r) : "n/a",
    a.kind === "killer"
      ? ("state=" + a.state + " tgt=" + JSON.stringify(a.target) + " heard=" + JSON.stringify(a.heard) + " pf=" + a.patrolFloor)
      : ("aiState=" + a.aiState + " goal=" + a.goalFloor));
}
console.log("hall", JSON.stringify(W.geom.hall), "corridor", JSON.stringify(W.geom.corridor));
console.log("stairZoneB", JSON.stringify(W.geom.stairZoneB));
