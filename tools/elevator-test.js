/* ============================================================
 * elevator-test.js · 电梯规则回归测试（无头）
 * ------------------------------------------------------------
 * 用法：node tools/elevator-test.js
 * 每条用例都会把车放到指定状态，喂一个指令/呼梯，看它第一站停在哪。
 * 规则来自一代 docs/DESIGN.md 5.2（SCAN / 方向事件队列）。
 * ============================================================ */
const fs = require("fs"), vm = require("vm");
const FILES = ["js/config.js", "js/geom.js", "js/nav.js", "js/world.js", "js/ai.js"];

function mk() {
  const sb = { console, Math, Date, JSON, Set, Map, isFinite, parseFloat, parseInt, window: {}, setTimeout, Uint8Array, Float32Array, Int32Array };
  sb.globalThis = sb; vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: f });
  const W = sb.World, w = W.init(sb.CFG);
  /* 把 AI 全部冻结，避免干扰 */
  for (const a of w.actors) {
    if (a.kind === "killer") { a.floor = 20; a.x = 3; a.y = 1; a.aiTimer = 1e9; a.travel = null; }
    else if (!a.controlled) { a.floor = 19; a.x = 3; a.y = 1; a.aiTimer = 1e9; a.travel = null; }
  }
  for (let f = 1; f <= 20; f++) { w.hallUp[f] = false; w.hallDown[f] = false; }
  const C = w.elevators[0], D = w.elevators[1];
  D.floor = 20; D.dir = 0; D.state = "idle"; D.doorsOpen = false; D.calls.clear(); D.aiTimer = 1e9;
  C.calls.clear();
  const p = w.player;
  p.space = "car"; p.carId = "C"; p.floor = C.floor; p.x = C.cx; p.y = -4.2;
  return { W, w, C, p };
}

let pass = 0, fail = 0;
function expect(name, setup, want) {
  const { W, w, C, p } = mk();
  setup(C, w, p);
  const dt = 1 / 60;
  const stops = [];
  let lastOpen = false;
  for (let i = 0; i < 60 * 120; i++) {
    W.update(dt);
    if (C.doorsOpen && !lastOpen) stops.push(Math.round(C.floor));
    lastOpen = C.doorsOpen;
    if (stops.length >= 3) break;
  }
  const got = stops.slice(0, 3).join(",");
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log((ok ? "√" : "×") + " " + name.padEnd(30) + " 停靠:[" + got + "]  期望:[" + want + "]");
}

/* 轿厢选层：不管在哪按，第一站就是它 */
expect("A 1F按5", (C, w, p) => { C.floor = 1; C.dir = 0; C.state = "idle"; C.doorsOpen = false; C.openAmt = 0; w.playerPressCarFloor(5); }, "5");
expect("B 1F门开着按5", (C, w, p) => { C.floor = 1; C.dir = 0; C.state = "open"; C.doorsOpen = true; C.openAmt = 1; C.timer = 3; w.playerPressCarFloor(5); }, "1,5");
expect("C 关门途中按5", (C, w, p) => { C.floor = 1; C.dir = 0; C.state = "closing"; C.doorsOpen = false; C.openAmt = 0.5; C.timer = 0.6; w.playerPressCarFloor(5); }, "5");
expect("D 20F下呼梯+按5", (C, w, p) => { C.floor = 1; C.dir = 0; C.state = "idle"; C.doorsOpen = false; w.hallDown[20] = true; w.playerPressCarFloor(5); }, "5");
expect("E 上行3F时按5", (C, w, p) => { C.floor = 3; C.dir = 1; C.state = "moving"; C.doorsOpen = false; w.playerPressCarFloor(5); }, "5");
expect("F 已过5F(7F)按5", (C, w, p) => { C.floor = 7; C.dir = 1; C.state = "moving"; C.doorsOpen = false; w.playerPressCarFloor(5); }, "5");

/* 顺路：同方向呼梯停、反方向不停 */
expect("G 上行遇8F上呼梯", (C, w) => { C.floor = 1; C.dir = 1; C.state = "moving"; C.doorsOpen = false; w.hallUp[8] = true; }, "8");
expect("H 到顶掉头接下呼", (C, w) => { C.floor = 18; C.dir = 1; C.state = "moving"; C.doorsOpen = false; w.hallDown[6] = true; }, "6");

/* 门：关门途中被叫、反方向补开 */
expect("I 关门途中又被叫", (C, w) => { C.floor = 9; C.dir = 0; C.state = "closing"; C.doorsOpen = false; C.openAmt = 0.5; C.timer = 0.8; w.hallUp[9] = true; }, "9");
expect("J 反方向补开门", (C, w) => { C.floor = 5; C.dir = 1; C.state = "open"; C.doorsOpen = true; C.openAmt = 1; C.timer = 0.4; w.hallDown[5] = true; }, "5,5");

/* 顺序：先跑完上，再跑下 */
expect("K 上5下3", (C, w, p) => { C.floor = 1; C.dir = 0; C.state = "idle"; C.doorsOpen = false; C.calls.add(5); w.hallDown[3] = true; }, "5,3");

console.log("\n通过 " + pass + " / " + (pass + fail));
process.exit(fail ? 1 : 0);
