import type { ScrollDefinition } from "./definition";

/**
 * 地图移动类卷轴：用来代替本回合的正常移动骰，只能在还没掷骰时使用。
 *
 * 灵活行动对应"控制同一颗骰子"的手感；短程传送符、触手可得和任意门都是"跳过沿途"，
 * 后两者只是把 teleport 的距离分别锁死在 1、放开到不限——任意门是这条产品线的
 * 顶格版本，代价是稀有度给到 PR。具体差异见 cardEffects.ts 里
 * chooseMovement / teleport / teleportAnywhere 的注释。
 */
export const MOVEMENT_SCROLLS = {
  remoteDice: {
    name: "灵活行动",
    description: "地图阶段使用：指定本回合的移动点数（不超过当前移动骰上限），代替正常掷骰",
    rarity: "SR",
    timings: ["map"],
    effects: [{ type: "chooseMovement" }],
  },

  shortRangeTeleportCharm: {
    name: "短程传送符",
    description: "地图阶段使用：直接跃至前方至多 3 格处，代替正常移动；途中的营地回血与守关门计次都不会触发",
    rarity: "N",
    timings: ["map"],
    effects: [{ type: "teleport", maxDistance: 3 }],
  },

  withinReach: {
    name: "触手可得",
    description: "地图阶段使用：直接前进 1 格，代替正常移动",
    rarity: "N",
    timings: ["map"],
    effects: [{ type: "teleport", maxDistance: 1 }],
  },

  anywhereDoor: {
    name: "任意门",
    description: "地图阶段使用：直接传送至当前阶段地图上的任意一格，代替正常移动；不触发沿途任何效果",
    rarity: "PR",
    timings: ["map"],
    effects: [{ type: "teleportAnywhere" }],
  },
} satisfies Record<string, ScrollDefinition>;
