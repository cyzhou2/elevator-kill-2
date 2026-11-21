# 开发者调参手册 · 电梯公寓大逃杀 2

玩家端没有任何可调项。所有数值都在 **`js/config.js`** 里，改完刷新页面即可。
本文件是给开发者用的：一目了然该改哪一行，以及几套「整段替换」的预设。

---

## 0. 一分钟上手

```bash
# 本地起服务（推荐，省得浏览器对 file:// 挑食）
node tools/serve.js 5199      # 打开 http://127.0.0.1:5199/

# 无头跑局：验证规则与 AI，不渲染
node tools/headless.js 180 3 2 7
#   参数：秒数  小孩数  杀人犯数  随机种子

# 看某一时刻所有角色的状态
node tools/inspect.js 1800      # 第 1800 帧（30 秒）
node tools/encounter.js         # 统计追击次数、同层可见帧、最近距离
```

改了逻辑先跑 `node tools/headless.js`，确认还能跑、抓捕数没跑偏，再进浏览器看画面。

---

## 1. 数值分区

`js/config.js` 里分 8 块：

| 块 | 管什么 | 改动的风险 |
|---|---|---|
| `FLOORS / FLOOR_LEN / CORRIDOR_W / STAIR_* / HALL_* / WALL_T / CAR_*` | **★ 版面与美术** | 改了要重新看画面、重新调镜头 |
| `ROUND_SEC / KIDS / KILLERS / START_FLOOR` | 一局规则 | 低 |
| `KID` | 玩家手感 | 低（影响躲不躲得掉） |
| `KILLER` | 追杀强度 | 低（影响难度） |
| `ELEV / STAIR / DOOR` | 电梯与门的时间 | 低 |
| `TENSION` | 心跳 / 渗红 / 抖屏的触发距离 | 只影响氛围 |
| `LOOK` | 颜色、颗粒、扫描线、尘埃 | 只影响画面 |
| `AUDIO / SCORE` | 音量、心率、计分 | 只影响听感与分数 |

---

## 1.5 v1.1 新增的三件事

### 寻路（js/nav.js）

- 可走区域切成 **0.2 m 网格**，A* 找路 + 直线拉直（能直连就删中间点）。
- 门洞只有 0.3 m 宽，连接段按「外扩 0.11 m」判定，否则格子连不上。
- 玩家点地面、AI 追人都走这条路径；`Nav.follow()` 接近关着的楼梯门时会自动推开。
- 想调：`nav.js` 顶部 `CELL`（格子大小）与 `CLEAR_R`（离墙余量）。

### 撞墙退让（world.js · moveActor）

- 一步走不动时按 1 / 0.75 / 0.5 / 0.35 / 0.25 / 0.15 / 0.08 的比例退让，贴墙也能滑动。
- 以前只有「能走 / 不能走」，人被 1 厘米墙缝卡死，这是抽搐与卡住的主因之一。

### 呼梯与面板

- 一部梯一个「呼」按钮（不分上下），`world.hallCall[floor]` 记录被叫的梯号。
- `world.panelVisible()`：进电梯厅或离厅心 5.2 m 内才为真；只有为真时显示 `#callPanel`，也只有这时键盘 `E` 才能呼梯。
- 面板上的 `12F ▲` 来自 `UI.carRead()`（门开着显示「本层 · 开门」）。

### 控制对照

| 位置 | 键盘 | 说明 |
| --- | --- | --- |
| 楼梯口 | `E` 上楼 / `Q` 下楼 | `W/S` 只平移，不再抢楼梯 |
| 轿厢 | `E` 开门 / `Q` 关门 / `Space` 出梯 | 面板最后一行也有图标键 |
| 电梯厅 | `E` 叫最近的梯 | 面板出现时才有效 |
| 任何时候 | 鼠标点地面 | A* 寻路过去 |

### 杀人犯凶残程度（v1.1）

```js
KILLER.sight: 11.5      // 视野半径
KILLER.sightCone: 1.35  // 视野半角
KILLER.hearWalk: 8.0    // 听到走路
KILLER.hearSprint: 14.0 // 听到冲刺
KILLER.chase: 3.05      // 追击速度（玩家冲刺 3.30）
KILLER.thinkSec: 0.22   // 决策间隔
```

小孩被追时的逃跑速度是 `KID.sprint * 0.70`（`ai.js` 的 `kidUpdate`）：调大更难抓，调小一追一个准。

## 1.8 v1.2 新增

- **自动开门**：`world.autoOpenDoor(a)`，任何寻路（玩家点击、AI 追击、上下楼）都会调用，半径 1.25 m。
- **楼梯过场**：`render.js` 的 `drawStairScene()`，按 `player.stair` 的 `from/to/dir/t/dur` 画楼梯与进度；时长由 `STAIR.traverseSec` 控制。
- **氛围音效**：`audio.js` 里 `whisper / creak / farSteps / pipeKnock / breath / setCarHum`，由 `update()` 的 `ambTimer` 按紧张度调度；混响用合成脉冲响应（`reverb`）。
- 想调节氛围密度：改 `ambTimer` 的重置公式（现在是 `12 - tension*7` 起步，越大越安静）。
- 想调节音量：`CFG.AUDIO.master`，或单独改 `whisper(0.03 + tension*0.045)` 里的系数。

## 1.7 呼梯模型（v1.3）

- 状态是**按层按方向**的两个布尔：`world.hallUp[floor]` / `world.hallDown[floor]`，全楼共享，不绑定某部梯。
- `hasCall(e, f, dir)`：车在 `dir` 方向上只认这一方向的呼梯（加上轿厢内选层），所以上楼时不会为下楼的人停。
- 本层开门时清掉对应方向的呼梯；`dir===0`（待机/掉头）时两个方向一起清。
- 端头限制在 `world.playerCallElevator(dir)` 与 `world.canCall(dir)` 里（1 楼不能下、20 楼不能上）。
- 面板 UI：`#cpUp` / `#cpDown`，亮起 = 该方向已有人叫；`disabled` = 端头按不了。

## 1.6 电梯核心（v1.4，照搬一代 SCAN）

规则来源：一代 `docs/DESIGN.md` 5.2 与 `src/model/elevator.js`。v2 的实现全在 `js/world.js`：

| 函数 | 作用 |
| --- | --- |
| `wantsStopAt(e, f, dir)` | 这一层这一方向要不要停：轿厢选层 or 同方向呼梯（dir=0 时任何呼梯都算） |
| `queueFor(e, dir)` | 当前方向的事件队列，含本层，按行进顺序排序 |
| `planElevator(e)` | 只做决策：本层该停→开门 / 正向有活→继续 / 反向有活且整层→掉头 / 都没活→截最近呼梯 / 真没有→待机或靠层 |
| `elevatorMove(e, dt)` | 逐层推进，**每跨一层都复查一次**，该停就 `openDoors` |
| `openDoors(e, f, dir)` | 开门并清掉**本方向**的呼梯；反方向还亮着就记 `mustReopen`，关门后补开一次 |

常见改法：

- 电梯太快/太慢：`ELEV.secPerFloor`（秒/层）
- 门停多久：`ELEV.doorHoldSec`、开合时间 `doorOpenSec/doorCloseSec`
- 想验证改动没破坏规则：`node tools/elevator-test.js`（11 条用例必须全绿）

## 1.55 楼梯按钮（v1.4）

- `#stairPanel`：`world.nearStairs()` 为真时出现，两个按钮直接调 `World.playerTryStairs(±1)`。
- 端头禁用靠 `player.floor >= CFG.FLOORS` / `<= 1` 判断。

## 1.45 电梯口互动细节（v1.5）

全部在 `js/render.js`：

| 细节 | 位置 | 想调什么 |
| --- | --- | --- |
| 到站灯 | `drawElevator` 里 `lampOn` | 亮度/呼吸频率 |
| 运行箭头 | 显示屏文字 `▲▼◦▪` | 字符 |
| 开门倒计时 | `e.timer / CFG.ELEV.doorHoldSec` | 改 `ELEV.doorHoldSec` 就会跟着变 |
| 门缝警示条 | `hazardA`（closing 时闪烁） | 闪烁频率 `world.time*18` |
| 消防栓/告示牌/地垫 | `bakeProps` 的电梯厅段 | 位置与颜色 |

## 1.46 轿厢内方向键（v1.5）

- DOM：`index.html` 的 `#carPad`，四个 `[data-cm]` 按钮；只在 `player.space === 'car'` 时显示（`ui.js` 里 `showPad`）。
- 输入：`input.js` 的 `padOn{up,down,left,right}`，在 `poll()` 里直接叠加到主轴，和 WASD/摇杆同一套。
- 进轿厢时给 `<body>` 加 `inCar` 类，`styles.css` 用它隐藏摇杆（`body.inCar #joy{display:none}`）。
- 想改键位/大小：`styles.css` 的 `#carPad` 与 `.cpad`。

## 1.35 移动端布局（v1.6）

- `styles.css` 顶部有一个变量 `:root{--ctl:0px}`，竖屏媒体查询里改成 `148px`，横屏小屏 `104px`。
- 画布尺寸跟着它走：`#stage{ height: calc(100vh - var(--ctl)) }`。**注意** `#stage` 上有 `height:100%`，只改 `inset` 是无效的，必须显式写 height。
- 所有浮层都用 `bottom: calc(var(--ctl) + N)` 定位，保证落在操作条里。
- 面板的默认规则写在文件靠后，所以竖屏覆盖要用更高优先级（`body #callPanel`），或者把覆盖块放到文件最后。
- 旋转已关闭：`render.js` 的 `layout()` 里 `var rotate = false;`（代码保留，想恢复改回去即可）。
- 进轿厢时 JS 给 `<body>` 加 `inCar`（驼峰），CSS 里请用 `body.inCar`。

## 0.7 双出口 / 更强的 AI / 纯点击（v2.7）

### 双出口

- `world.exitSpots()` 返回两个：`{id:'1', floor:1}` 和 `{id:'top', floor:FLOORS}`，位置都在各自大厅。
- `nearExitSpot()` / `prompts()` / `promptAction('exit', id)` / `playerUse()` 全部走这套；`nearExit()` 只是它的布尔封装。
- 想加第三个出口：往 `exitSpots()` 里 push 一条即可（HUD 与绘制会自动带上）。

### AI 目标意识

```js
KILLER.guardBias: 0.55   // 选巡逻层时，直接奔向"还有配电箱/出口"的层的概率
```

- 实现在 `ai.js` 的 `nextSweepFloor()`：先看 `hotFloors()`（没修完=配电箱层，修完=两个出口层），掷骰子命中就直接返回该层。
- 想更凶：`guardBias` 0.8、`patrol` 2.0；想松一点降到 0.3。

### 移动与静音

- 摇杆已从 `index.html` / `styles.css` 移除，`input.js` 里 `els.joy = null`（代码留着但永不激活）。移动 = 点击地面（`setWalk` + Nav A*）。
- `#muteBtn` 绑定 `Audio2.setMute`，状态用 `.off` 类表现；和键盘 `M` 等价。

## 0.75 电梯出梯 = 走出去（v2.6）

`world.js` 的 `moveActor` 里，轿厢分支多了一段：

```js
if (doorOpen && dy > 0.002 && ny > cr.y + cr.h - r * 0.75) {
  a.space = "floor"; a.floor = Math.round(ce.floor); a.carId = null;
  a.x = clamp(a.x, cr.x + 0.15, cr.x + cr.w - 0.15);
  a.y = G.hallY0 + 0.24;
}
```

- 也就是「门开着 + 往门口方向走 + 走到南边缘」就自动变成楼层状态，不需要按钮。
- 轿厢画面里点下沿/门外 → `carToWorld` 直接给一个大厅坐标，人就走过去了。
- `playerExitCar` 还留着（Space 兼容），但 UI 上的「出」按钮已删除。
- 杀人犯跟车：`stepKiller` 里如果 `chaseKid` 的人在轿厢且门开着，它会直接朝门口移动并合法进梯。

## 0.8 板子 / 伤害 / 感知（v2.5）

### 板子（`geom.pallets` + `world.pallets[floor][i]`）

- 位置在 `geom.js`：`rect(6.2, 0, 0.34, corridor.h)` 和 `rect(11.6, ...)`，横跨走廊。
- 状态 `{open, amt, broken, breaking, breakingBy}`，默认 `open: true`。
- 挡路：`wallsAt()` 里 `!broken && !open && amt < 0.55` 时把矩形塞进墙列表。
- 交互：`nearPallet()` / `togglePallet(i)` / `breakPallet(killer, floor, i, dt)`；
- AI：`blockedDoor()` 先查板子再查楼梯门，`smash()` 统一处理破门/破板。
- 想加更多板子：往 `geom.js` 的 `pallets` 数组里加矩形即可（`world` 会按层自动建状态）。

### 伤害（`catchKid`）

```js
KILLER.attackRecover: 1.7   // 擦刀
KILLER.catchRange: 0.62
PLAYER.lives: 2             // 2 = 一刀倒(受伤)，再一刀死
PLAYER.hasteSec: 3.2, hasteMul: 1.42
PLAYER.invulnSec: 3.0       // 无敌帧（catch 循环里跳过 invuln>0 的人）
```

顺序：抓中 → `lives--`、`recoverT=1.7`、`invuln=3`、`haste=3.2`、`hurt=12`、击退 → 这 3 秒内任何人都抓不到你。

### 感知（`ai.js` 的 `detectKid`）

- **每帧**跑（不是决策节拍），先锥形视野，再兜底 2.6 米 360° 感知（需 0.45 秒确认）。
- 优先级高于 `travel`——所以它不会一边赶路一边无视贴脸的玩家。
- 想更凶：`KILLER.senseRadius` 调到 3.5、`senseDelay` 降到 0.2；`sightCone` 调到 1.6（≈92°）。

## 0.85 交互图标与板子门（v2.3）（v2.3）

### 图标（`world.prompts()` → `render.drawPrompts()` → 点击 → `world.promptAction()`）

- `prompts()` 返回数组：`{kind, id, icon, label, x, y, near, progress, breaking}`。
- `kind`：`fuse` / `exit` / `door`；`icon`：`bolt` / `exit` / `door`（画在 `drawPrompts` 里，纯 Canvas 图形）。
- 点击命中在 `main.js` 的 `hitPrompt(raw)`（半径 26px），优先于「点地走路」。
- **E / 用 是一等公民**：`doAction('interact')` 里保留 `World.playerUse()`，和点图标等价；两条路都走 `promptAction` 的世界逻辑。
- 加新交互物：在 `prompts()` 里 push 一条，并在 `promptAction()` 里加一个分支即可。

### 门（板子）

- 状态：`open`（默认 true）/ `broken`（被砸烂）/ `amt`（0~1 开门动画）/ `breaking`（0~1 读条） / `breakingBy`。
- 挡路：`wallsAt()` 里 `!broken && !open && amt < 0.55` 时把门矩形加进墙。
- 破门：`world.breakDoor(killer, floor, landing, dt)`，时长 `DOOR.breakSec`（2.4s），破完 `broken=true` 永久失效。
- AI：`ai.js` 的 `blockedDoor()` 判定，`killerUpdate` 顶部优先处理（追击/换层/听声都会先砸门）。
- 小孩：`autoOpenDoor` 只对小孩和玩家以外……准确说是**玩家和杀人犯都不自动开门**，小孩会自动推开。
- 想更狠：`DOOR.breakSec` 调到 4~5，玩家就有更长的逃生窗口；调到 1.2 会非常压迫。

## 0.9 恐怖氛围系统（v2.2）（v2.2）

### 音乐层（`audio.js`）

| 函数 | 作用 |
| --- | --- |
| `startMusic()` | 第一次点击/按键时启动：铺底 pad + 风声，渐变入场 6 秒 |
| `setMusicTension(t)` | 每帧调用：pad 音量 `0.028 + t*0.075`、滤波 `200 + t*300`、调式根音 55 / 51.9 / 58.3 三档 |
| `motif(vol)` | 八音盒走音旋律（小调音阶 + 0.29s 延迟反馈） |
| `stinger()` | 三全音上冲 + 撞击，`ai.js` 里进入 chase 时触发 |
| `silenceDrop(sec)` | 把 `bus.gain` 压到 0.0005 一到两秒再抬回来 |

### 惊吓调度（`world.js`）

- `triggerScare(kind)`：`flicker` / `slam` / `whisper` / `silence` / `ding`，不传 kind 就按权重随机。
- 每 22~46 秒自动触发一次；`W.flicker` 是 1→0 的衰减量，`render.js` 用它压暗环境光 + 加颗粒 + 叠一层黑。
- 想调频率：`W.scareTimer = rnd(22, 46)`（`world.js` 的 `update` 里）。

### 同乘恐惧

- `W.carDread`：玩家和任何活着的角色在同一轿厢 → 1。
- `render.js` 用它：额外暗角 + 极轻红色呼吸 + 颗粒；轿厢里的人按真实坐标绘制（`drawCarScene` 里的 `boxPt`）。

## 1.05 威胁曲线与「没有倒计时」（v2.1）与「没有倒计时」（v2.1）

```js
THREAT: { base: 1.0, perFuse: 0.05, perMinute: 0.02, max: 1.25 }
ROUND_SEC: 0   // 0 = 不限时；>0 才启用硬性时限（endRound('time')）
```

- `world.threat` 每帧重算，`ai.js` 里追击/巡逻速度都乘它。
- 1.25 倍时追击速度约 3.8 m/s，玩家冲刺 3.30 —— 后期**跑不掉**，只能靠楼梯/电梯/门甩开，这是有意的。
- HUD 的 `#clock` 现在显示已用时间 + 威胁等级（`ui.js` 的 `el.clock.innerHTML`）。

## 1.06 轿厢内交互（v2.1 修过的坑）

- **点哪走哪**：`render.js` 的 `carBox()/carToWorld()` 把屏幕坐标换算成轿厢内世界坐标，`main.js` 的 `onStageClick` 里直接 `setWalk([点])`。
- 删除旧逻辑：以前点画面下半 28% 会 `playerExitCar()`，和「点着移动」直接冲突。
- `playerExitCar` 现在三态：门开 → 直接出；门关且停稳 → `pendingExit` + 开门，开门后自动送出去；还在跑 → `pendingExit`，到站开门自动出。
- `world.boardOpenCar()`：门开着 + 站得近，按 `用` 直接进轿厢（比点轿厢更直觉）。
- 门口感应：`case "open"` 里如果玩家在门口 2.6 m 内，`e.timer` 会被续到 0.75×hold，避免被夹。

## 1.1 目标制玩法（v2.0）

### 一局的流程

```
开局 → 随机 3 个楼层生成配电箱（HUD 显示楼层）
     → 逐个「站定 + 按 用」修理（6s/个，噪音 12m/0.8s）
     → 每修好一个：该层通电（画面变亮）
     → 3/3 完成：1F 大厅紧急按钮亮起
     → 回 1F 按 用 → 逃生成功（结算分数）
失败：时间到 / 被抓住第二次
```

### 数值（`config.js`）

```js
OBJ: {
  fuses: 3,            // 要修几个
  repairSec: 6.0,      // 每个要多久
  noiseEvery: 0.8,     // 修理噪音间隔
  noiseRadius: 12.0,   // 噪音半径（直接决定难度）
  touchDist: 1.0,      // 多近算在修
  breakDist: 1.5       // 走多远中断（进度保留）
},
PLAYER: { lives: 2, hurtSec: 12, hurtSpeed: 0.86, invulnSec: 3 }
```

### 实现位置

| 内容 | 位置 |
| --- | --- |
| 生成配电箱 / 修理判定 / 逃生判定 | `world.js`：`buildFuses`、`nearFuse`、`nearExit`、`updateRepair`、`playerUse` |
| 受伤处理 | `world.js` 的 `catchKid`（`W.lives > 1` 分支） |
| 通电变亮 | `render.js` 的 `buildLight`（`World.power[viewFloor]` → dark 0.865→0.70） |
| 配电箱 / 紧急按钮绘制 | `render.js` 的 `drawObjectives` |
| 目标面板 / 读条 / 结算 | `ui.js` 的 `updateObjectives`、`showEnd` |
| 输入 | `main.js` 的 `doAction('interact')` → `World.playerUse()` |

### 调难度最快的方式

- 想更简单：`OBJ.noiseRadius` 降到 8，或 `repairSec` 降到 4，或 `PLAYER.lives` 改 3。
- 想更凶：`OBJ.noiseRadius` 拉到 16、`noiseEvery` 降到 0.5；或 `OBJ.fuses` 改成 4~5。
- 结构传声（上下两层能听到修理声）的概率写死在 `world.js` 的 `emitNoise`（现在是 0.5，`gapF <= 2`）；想更狠就把 `gapF <= 3`、概率 0.75。
- 注意：`fuses` 超过 5 时 5 分钟会不够，把 `ROUND_SEC` 一起调。

## 1.2 AI 现状（v1.7）

### 小孩（`ai.js` · `kidUpdate`）

| 优先级 | 条件 | 行为 |
| --- | --- | --- |
| 0 | 在轿厢里 | 按目标楼层，到站开门后走出 |
| 1 | 同层、视线通、距离 ≤ 6.5 m 看到杀人犯 | 锁定 2.5 秒挑远的那个楼梯间，以 `sprint*0.70` 冲过去上楼 |
| 2 | 有 `goalFloor`（每 7~14 秒有 45% 概率定一个） | 找一个楼梯间走过去、换层，到了先歇 1.2~2.6 秒 |
| 3 | 其它 | 在走廊随机取点走到底，到了歇 1~3 秒再取新点 |

特点：只用「看得见」判断危险，没有听觉/记忆；逃跑必然走楼梯；从不用电梯；不会关门、不会躲。

### 杀人犯（`ai.js` · `killerUpdate`）

| 优先级 | 条件 | 行为 |
| --- | --- | --- |
| 0 | 在轿厢里 | 到目标层开门后出来 |
| 1 | `a.travel` 存在 | 走楼梯或坐电梯换层；等电梯超过 9 秒改走楼梯 |
| 2 | 每 0.22 秒：同层 + 视线通 + ≤11.5 m + 在 ±1.35 rad 视野内 | 进入 chase，**每帧盯住小孩实时位置** |
| 3 | 4 秒内听到噪音（脚步/开门/电梯叮） | 去噪音点 search |
| 4 | 另一个杀人犯 8 秒内给过情报 | 去那个坐标/楼层 |
| 5 | 都没有 | 按 ±`sweepSpan`(3) 层扫楼，`checkedCool` 25 秒不重复 |

移动一律走 `Nav` 网格 A*（自动开门），追击 3.05 m/s，巡逻 1.55 m/s。

已知短板：跟丢就没有下文（不会在原地附近搜）；不会去电梯口蹲守；不会用楼梯声判断目标换了哪层；两个杀人犯只共享坐标。

## 2. 想改难度：只动这 5 个

```js
KID.speed: 2.15        // 玩家走路
KID.sprint: 3.30       // 玩家冲刺
KID.stamina: 100       // 体力上限
KID.staminaDrain: 21   // 冲刺每秒消耗
KILLER.chase: 2.85     // 它追你的速度
```

**平衡铁律**：`KILLER.chase` 要
**大于 `KID.speed`、小于 `KID.sprint`**。
这样"走路会被追上、冲刺能拉开、但体力有限"，才有"要不要跑"的抉择。

| 想要的手感 | `KID.speed` | `KID.sprint` | `KID.staminaDrain` | `KILLER.chase` |
|---|---|---|---|---|
| 很安全（看看风景） | 2.15 | 3.30 | 21 | 2.45 |
| **默认（推荐）** | **2.15** | **3.30** | **21** | **2.85** |
| 有点压力 | 2.10 | 3.25 | 24 | 3.00 |
| 很凶（能跑掉算你厉害） | 2.05 | 3.20 | 27 | 3.15 |

> 不要 `KILLER.chase` ≥ `KID.sprint`：一旦被抓到视野里就必死，玩家会觉得"这游戏不讲理"。
> 也不要 `KILLER.chase` ≤ `KID.speed`：它永远追不上人，恐怖感全没了。

---

## 3. 想改节奏：时间

```js
ROUND_SEC: 180          // 一局时长
ELEV.secPerFloor: 1.6   // 电梯一层要多久
ELEV.doorHoldSec: 3.6   // 门开着等多久
STAIR.traverseSec: 1.5  // 走一段楼梯的过场
DOOR.openSec: 0.55      // 推门动画
STAIR.doorAutoClose: 8  // 楼梯间的门多久自己关上
```

把握两点：

- `STAIR.doorAutoClose` 比 `STAIR.traverseSec` 长很多，否则你还在过场里，门就关了。
- `ELEV.doorHoldSec` ≥ 2.5 秒，否则玩家来不及走进轿厢。

---

## 4. 想改视觉：颜色与后期

```js
LOOK.floor / floorAlt / grout     // 走廊地砖三色（决定"水泥感"）
LOOK.wall / wallTop / wallEdge    // 墙 / 墙顶高光 / 墙边阴影（伪 3D 挤出）
LOOK.lampWarm / lampCold          // 吊灯色
LOOK.dust                         // 尘埃粒子数（120~220 之间比较自然）
LOOK.grain                        // 胶片颗粒（0.03~0.08）
LOOK.scanline                     // 扫描线（0.03~0.07）
```

调亮/调暗整幅画面，改这三处：

1. `LOOK.floor` 等底色（最直接）
2. `render.js` 里 `buildLight()` 的 `var dark = ...`（0.90 左右；越大越黑）
3. `config.js` 的 `KID.ambient`（贴身可见半径）

`render.js` 里还有两处硬编码的"气氛"参数，想动就动：

- 手电锥：`CFG.KID.fov`（半角）与 `CFG.KID.vision`（长度）
- 暗角：`crt()` 里的 `vg` 两个 stop
- 紧张渗红：`TENSION.vignetteRadius` 与 `crt()` 里的 `rv`

---

## 5. 想改声音

```js
AUDIO.master: 0.55      // 总音量
AUDIO.droneVol: 0.06     // 底噪嗡鸣
AUDIO.stepVol: 0.14      // 脚步
AUDIO.heartVol: 0.5      // 心跳
AUDIO.heartbeatBase: 58  // 平静心率
AUDIO.heartbeatMax: 140  // 它贴脸时的心率
```

心率的实际值是 `base + (max - base) * tension`，`tension` 由它离你多近决定（`TENSION.heartRadius`）。
想"更早开始心跳"就把 `TENSION.heartRadius` 调大（9.0 → 12.0）。

---

## 6. 想改 AI

```js
KILLER.sight: 9.5         // 视野半径
KILLER.sightCone: 1.2      // 视野半角（弧度，1.2 ≈ 69°）
KILLER.hearWalk: 6.0       // 听到走路
KILLER.hearSprint: 11.0    // 听到冲刺
KILLER.hearDoor: 7.5       // 听到推门
KILLER.thinkSec: 0.35      // 决策节拍（越小反应越快）
KILLER.sweepSpan: 3        // 一次扫几层
KILLER.checkedCool: 25     // 刚查过的层多久不重复
KILLER.preferStairs: 0.78  // 走楼梯的概率（其余坐电梯）
KILLER.catchRange: 0.62    // 抓到判定距离
KILLER.catchTime: 0.45     // 抓取读条（越大越好逃）
```

想让 AI 主动撞见玩家：调大 `sight` / `hearWalk`，或把 `thinkSec` 调到 0.2。
想让它别太黏人：调小 `sight`、`hearWalk`，或把 `catchTime` 调大到 0.8。

小孩 AI 的逃跑速度是 `KID.sprint * 0.78`（在 `js/ai.js` 的 `kidUpdate` 里），
调低它 → 小孩更容易被抓；调高 → 更难。

---

## 7. 整段替换的预设

### 预设 A：更紧张（默认再压一档）

```js
// js/config.js
KID: { speed: 2.10, sprint: 3.25, stairSpeed: 1.55, radius: 0.22,
       vision: 8.0, ambient: 3.6, fov: 1.02,
       stamina: 100, staminaDrain: 24, staminaRegen: 15, turnRate: 12, reaction: 0.18 },
KILLER: { patrol: 1.55, chase: 3.00, stairSpeed: 1.6, radius: 0.26,
          sight: 10.5, sightCone: 1.25, hearWalk: 7.0, hearSprint: 12.0, hearDoor: 8.0,
          catchRange: 0.62, catchTime: 0.40, loseSightSec: 4.0,
          thinkSec: 0.28, sweepSpan: 3, checkedCool: 22, preferStairs: 0.72 },
TENSION: { heartRadius: 12.0, vignetteRadius: 8.0, shakeRadius: 2.6 }
```

### 预设 B：更轻松（能安心逛楼）

```js
KID: { speed: 2.20, sprint: 3.40, stairSpeed: 1.60, radius: 0.22,
       vision: 8.5, ambient: 4.0, fov: 1.05,
       stamina: 120, staminaDrain: 18, staminaRegen: 18, turnRate: 12, reaction: 0.18 },
KILLER: { patrol: 1.45, chase: 2.45, stairSpeed: 1.5, radius: 0.26,
          sight: 8.0, sightCone: 1.1, hearWalk: 4.5, hearSprint: 9.0, hearDoor: 6.0,
          catchRange: 0.55, catchTime: 0.70, loseSightSec: 3.0,
          thinkSec: 0.45, sweepSpan: 2, checkedCool: 30, preferStairs: 0.85 },
TENSION: { heartRadius: 7.0, vignetteRadius: 4.5, shakeRadius: 1.8 }
```

### 预设 C：只有 1 个它（单人恐怖感更强）

```js
KILLERS: 1,
KID: { /* 同默认 */ },
KILLER: { /* 同默认，但把这几项加强 */ thinkSec: 0.25, sweepSpan: 4, hearWalk: 7.5 }
```

### 预设 D：短片模式（60 秒一局，适合录素材）

```js
ROUND_SEC: 60,
ELEV.secPerFloor: 1.2,
ELEV.doorHoldSec: 2.8,
STAIR.traverseSec: 1.1,
```

---

## 8. 版面改了要一起改什么

`FLOOR_LEN / CORRIDOR_W / STAIR_* / HALL_* / WALL_T` 这几个一改，下面会自己跟着变（都是从这个几个算出来的）：

- `geom.js` 会把墙、门洞、楼梯段、井道、吊灯位置全部重算；
- `render.js` 的烘焙图、镜头取景自动重算；
- 移动碰撞、视线遮挡、喜梯按钮位置自动重算。

**不用手改任何坐标。** 唯一要注意的是：

- `HALL_W` 必须 ≤ `FLOOR_LEN - 2 * (STAIR_W + WALL_T)`，否则电梯厅会顶到楼梯间；
- `CAR_W` 必须 ≤ `HALL_W - 2 * (1.1 + 0.6)`（两部电梯门 + 中间柱子 + 两侧余量）。

改完先跑一遍 `node tools/headless.js 60`，确认没有卡死（`stuck` 数值不会爆炸），再进浏览器。

---

## 9. 常见问题

**Q：为什么它一直待在同一层？**
看 `KILLER.sweepSpan` 和 `checkedCool`。扫楼是"到点 → 换层 → 再走"，如果 `checkedCool` 太大、`sweepSpan` 太小，它会一直在相邻两层打转。

**Q：为什么它总往电梯厅跑？**
电梯每到一层都会发一次"到站噪声"（`world.js` 的 `openDoors` → `emitNoise(..., "elev")`），它会去查。这是故意的：坐电梯就得冒这个险。嫌太频繁就把那个半径从 4.0 改小。

**Q：玩家卡在墙角动不了？**
`world.js` 的 `unstick()` 是兜底：每帧检查当前位置是否合法，不合法就往最近的合法点挪 0.1 m。若仍卡，多半是改了 `WALL_T` 或 `*_W` 导致门洞对不上，跑一次 `node tools/inspect.js 900` 看坐标。

**Q：画面太黑/太亮？**
顺序调整：`LOOK.floor` → `KID.ambient` → `render.js` 的 `dark`。三处各动 10% 就能明显感觉到。

---

## 10. 提交前检查

```bash
node tools/headless.js 180        # 能跑完、不死循环
node tools/encounter.js           # 追击/抓捕的数量级正常
```

- 抓捕数：3 小孩 / 2 杀人犯 / 180 秒下，平均 0.3 ~ 1.5 比较健康（太高玩家没法玩，太低没有压迫感）。
- `stuck` 数值只用来观察，不作断言（小孩站着发呆也算）。
