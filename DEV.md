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
