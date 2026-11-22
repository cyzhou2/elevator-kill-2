/* ============================================================
 * 电梯公寓大逃杀 2 · 数值中枢
 * ------------------------------------------------------------
 * 这里是唯一改数值的地方。玩家端不提供任何调节入口。
 * 想调参 → 改这个文件 → 刷新页面（或按 DEV.md 里的「预设」整段替换）。
 * 带 ★ 的项直接挂钩美术与版面，改动后需要重新看一遍画面。
 * ============================================================ */
"use strict";

var CFG = {
  /* ---------- 版本 ---------- */
  VERSION: "v3.0",
  TITLE: "电梯公寓大逃杀 2",

  /* ---------- 楼体（★ 与美术/版面直接相关） ---------- */
  FLOORS: 20,            // 楼层数
  FLOOR_LEN: 18.0,       // ★ 一层总长（米）。18 米 = 两侧楼梯间 3.2×2 + 电梯厅 4.4 + 两段走廊 3.6×2
  CORRIDOR_W: 2.9,       // ★ 走廊宽（米）。太窄走位难受，太宽失去压迫感
  STAIR_W: 3.2,          // ★ 楼梯间面宽
  STAIR_D: 6.4,          // ★ 楼梯间进深（含楼梯段）
  HALL_W: 4.4,           // ★ 电梯厅面宽
  HALL_D: 3.0,           // ★ 电梯厅向北凹进的深度
  WALL_T: 0.3,           // ★ 墙厚（画面上墙体带一点伪 3D 挤出）
  DOOR_W: 1.0,           // ★ 门洞宽
  CAR_W: 1.7,            // ★ 轿厢内宽
  CAR_D: 1.6,            // ★ 轿厢内深
  STAIR_STEP_H: 0.28,    // 楼梯踏步画的进深（纯视觉）

  /* ---------- 局 ---------- */
  ROUND_SEC: 0,          // 硬性时限（0 = 不限时，靠目标结束一局）
  KIDS: 3,               // 小孩数（含玩家）
  KILLERS: 2,            // 杀人犯数
  START_FLOOR: 1,        // 玩家起始楼层（SPAWN.random 为 false 时才用这个）
  SPAWN: {
    random: true,        // 每局随机出生楼层
    minFloor: 2,
    maxFloor: 19
  },

  /* ---------- 角色 ---------- */
  KID: {
    speed: 2.15,         // 走路
    sprint: 3.30,        // 冲刺（Shift 按住）
    stairSpeed: 1.55,    // 楼梯上每「一段」的速度（米/秒，沿楼梯方向）
    radius: 0.22,
    vision: 8.0,         // 手电照亮半径
    ambient: 3.6,        // 不开手电也勉强看得见的贴身范围
    fov: 1.02,           // 手电锥半角（弧度）
    stamina: 100,
    staminaDrain: 21,    // 冲刺每秒消耗
    staminaRegen: 15,    // 不冲刺时每秒恢复
    turnRate: 12,        // 转身跟随鼠标/移动的柔顺度
    reaction: 0.18,      // 输入到起步的轻微迟滞（手感，不影响判定的那种）
    repairSec: 100.0,    // 小孩修一个配电箱要多久（玩家 30 秒）
    repairWander: 0.18,  // 修到一半分神的概率
    repairers: 2         // 最多几个小孩同时修
  },
  KILLER: {
    patrol: 1.85,        // 巡逻速度
    chase: 3.05,         // 追击速度（快于小孩走路，略慢于小孩冲刺）
    stairSpeed: 1.6,
    radius: 0.26,
    sight: 11.5,         // 视野半径（需要视线不被挡）
    sightCone: 1.35,     // 视野半角
    hearWalk: 9.5,       // 听到走路的半径
    hearSprint: 16.0,    // 听到冲刺的半径
    hearDoor: 9.0,       // 听到开门
    catchRange: 0.62,    // 抓到判定距离
    catchTime: 0.38,     // 抓取读条
    attackRecover: 1.7,  // 擦刀时间：得手后它站在原地收刀，这段时间不能动也不能抓
    stairSpeedMul: 0.72, // 它在楼梯上的用时倍率（越小越快）
    senseRadius: 2.6,    // 近身感知：不管朝哪边，这么近都会发现你
    senseDelay: 0.45,    // 近身感知的确认时间（给你一点点"溜走"的窗口）
    loseSightSec: 3.5,   // 跟丢后继续追最后位置的时间
    /* AI 决策节奏 */
    thinkSec: 0.22,
    sweepSpan: 3,        // 扫楼一次跨几层
    guardBias: 0.55,     // 有多大概率直奔"还有配电箱/出口"的楼层
    checkedCool: 16,     // 刚查过的层多久不重复
    preferStairs: 0.78   // 走楼梯的概率（其余坐电梯，制造「电梯门开了它站里面」的恐惧）
  },

  /* ---------- 电梯 ---------- */
  ELEV: {
    secPerFloor: 1.6,
    doorOpenSec: 1.15,
    doorHoldSec: 3.6,
    doorCloseSec: 1.15,
    doorZone: 1.05,      // 站在门口多近算「进出轿厢」
    callLampSec: 1.2     // 呼梯按钮亮起的余韵
  },

  /* ---------- 楼梯 ---------- */
  STAIR: {
    traverseSec: 1.5,    // 走一段楼梯（含开门）的过场时间
    doorAutoClose: 8.0   // 楼梯间门自动关上（恐怖片必备）
  },

  /* ---------- 门 ---------- */
  /* 门 = 第五人格的板子：平时开着，可以拉上挡住它，它要花时间破门 */
  DOOR: {
    openSec: 0.35,       // 拉开门
    closeSec: 0.3,       // 拉上门
    noise: 7.5,          // 开关门的声音半径
    breakSec: 2.4,       // 它破门要多久
    breakNoise: 10.0,    // 破门的动静
    slamStunSec: 0.5     // 你贴脸拉门时它会被顶一下（可调 0 关闭）
  },

  /* ---------- 追逐氛围 ---------- */
  TENSION: {
    heartRadius: 9.0,    // 杀人犯多近开始心跳
    vignetteRadius: 6.0, // 多近开始画面收窄
    shakeRadius: 2.2     // 多近开始轻微抖屏
  },

  /* ---------- 视听 ---------- */
  LOOK: {
    // 整体色板：冷灰绿墙体 + 暖黄的应急灯 + 一点血迹的红
    bg: "#070809",
    void: "#0a0b0c",
    wall: "#4b5254",
    wallTop: "#606a6d",
    wallEdge: "#181d1f",
    floor: "#3b4044",
    floorAlt: "#3f454a",
    grout: "#14181a",
    hall: "#303634",
    stair: "#333938",
    lampWarm: "#c9a86a",
    lampCold: "#7fa0a8",
    blood: "#4a1414",
    kid: "#d9e6e2",
    killer: "#0d0d0f",
    accent: "#b33a3a",
    text: "#c9d3cf",
    dim: "#6d7a76",
    dust: 150,           // 尘埃粒子数
    grain: 0.055,        // 胶片颗粒强度
    scanline: 0.05       // 扫描线强度
  },

  /* ---------- 音频 ---------- */
  AUDIO: {
    master: 0.55,
    droneHz: 54,         // 底噪嗡鸣
    droneVol: 0.06,
    stepVol: 0.14,
    heartVol: 0.5,
    heartbeatBase: 58,   // 平静时心率
    heartbeatMax: 140    // 杀人犯贴脸时心率
  },

  /* ---------- 计分 ---------- */
  /* ---------- 威胁升级（v2.1）：拖越久、修越多，它越快 ---------- */
  THREAT: {
    base: 1.0,
    perFuse: 0.05,       // 每修好一个配电箱，它快 5%
    perMinute: 0.02,     // 每分钟再快 2%
    max: 1.25            // 上限
  },

  /* ---------- 目标（v2.0） ---------- */
  OBJ: {
    fuses: 3,            // 要修几个配电箱
    repairSec: 30.0,     // 每个要按住多久（v3.0 起 ×5）
    noiseEvery: 0.8,     // 修的时候每隔多久响一声
    noiseRadius: 12.0,   // 修的时候的噪音半径（会招来杀人犯）
    touchDist: 1.0,      // 离多近算"在修"
    breakDist: 1.5       // 离开多远算中断（进度保留）
  },
  PLAYER: {
    lives: 2,            // 被抓几次才死
    hurtSec: 12.0,       // 受伤减速持续时间
    hurtSpeed: 0.86,     // 受伤时的速度倍率
    invulnSec: 3.0,      // 受伤后的无敌时间
    hasteSec: 3.2,       // 受击加速（第五人格那种"被打了反而跑得快"）
    hasteMul: 1.42       // 加速倍率
  },

  SCORE: {
    perSecond: 1,
    surviveBonus: 0
  }
};
