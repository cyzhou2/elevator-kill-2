/* 浏览器里跑一遍：点地面 → 呼梯 → 等门 → 进梯 → 按层 → 到站 → 出梯
 * 用法：把这文件内容粘到 DevTools console，或在 Playwright 里 evaluate。 */
(async () => {
  const g = window.EK2, w = g.world, p = w.player, G = w.geom;
  const stage = document.getElementById("stage");
  const rect0 = stage.getBoundingClientRect();
  const view = () => window.Render.view;
  const toScreen = (x, y) => {
    const v = view(), dx = (x - v.cx) * v.s, dy = (y - v.cy) * v.s;
    if (v.rotate) return { x: rect0.left + v.ox + dy, y: rect0.top + v.oy - dx };
    return { x: rect0.left + v.ox + dx, y: rect0.top + v.oy + dy };
  };
  const click = (x, y, label) => {
    const q = toScreen(x, y);
    stage.dispatchEvent(new MouseEvent("click", { clientX: q.x, clientY: q.y, bubbles: true }));
    log.push("点击 " + (label || (x.toFixed(1) + "," + y.toFixed(1))));
  };
  const step = (n) => { for (let i = 0; i < n; i++) g.step(0.05); };
  const waitFor = (fn, frames, label) => {
    for (let i = 0; i < frames; i++) { g.step(0.05); if (fn()) { log.push("等到了: " + label); return true; } }
    log.push("超时: " + label);
    return false;
  };
  const log = [];
  const C = () => w.elevators[0], D = () => w.elevators[1];
  const stateLine = () => w.elevators.map(e => e.id + "@" + e.floor.toFixed(1) + (e.doorsOpen ? "开" : e.state === "moving" ? "行" : "关")).join(" ");

  /* 1. 走到电梯厅 */
  click(G.hallCX, G.hallY0 + 1.0, "电梯厅");
  waitFor(() => p.y < -0.2, 200, "进电梯厅");
  log.push("位置 " + p.x.toFixed(2) + "," + p.y.toFixed(2));

  /* 2. 按呼梯 */
  click(G.elev.C.call.x, G.elev.C.call.y, "C 呼梯");
  waitFor(() => w.elevators.some(e => Math.abs(e.floor - p.floor) < 0.06 && e.doorsOpen), 900, "有一部门开");
  log.push("门开了: " + stateLine());

  /* 3. 走进轿厢 */
  const car = G.elev.C.car;
  click(car.x + car.w / 2, car.y + car.h / 2, "轿厢");
  waitFor(() => p.space === "car", 200, "进轿厢");
  log.push("进梯: " + p.space + "/" + p.carId);

  /* 4. 按 7 层 */
  const btn = [...document.querySelectorAll(".cf")].find(b => b.textContent === "7");
  if (btn) btn.click();
  step(4);
  log.push("按下 7F，C 梯 calls=" + [...C().calls].join(","));

  /* 5. 等到 7 层开门 */
  waitFor(() => C().doorsOpen && Math.abs(C().floor - 7) < 0.06, 1200, "到 7F 开门");
  log.push("到达: " + stateLine() + " 玩家 " + p.space);

  /* 6. 出门（空格） */
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
  step(4);
  log.push("出门后: " + p.space + " floor=" + p.floor + " viewFloor=" + w.viewFloor);

  /* 7. 走到楼梯间：点楼梯门 */
  click(G.stairDoorA.rect.x + G.stairDoorA.rect.w / 2, G.stairDoorA.rect.y + G.stairDoorA.rect.h / 2, "楼梯门A");
  waitFor(() => w.stairDoors[p.floor].A.amt > 0.5, 120, "楼梯门打开");
  log.push("门 A 打开 amt=" + w.stairDoors[p.floor].A.amt.toFixed(2));

  return { log, version: window.CFG.VERSION };
})();
