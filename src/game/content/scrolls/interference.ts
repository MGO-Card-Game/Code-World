import type { ScrollDefinition } from "./definition";

/**
 * 一次勒索抢走的定额，口径与 economy 的 GOLD_SCALE 一致（= 10 枚旧金币）。
 *
 * 写死在这里而不是引用 ECONOMY：卷轴内容表被 resources 引用，economy 又引用
 * resources，从这一层 import economy 会在模块初始化时拿到还没赋值的 ECONOMY。
 * 卷轴内容表一律只依赖 ./definition，这条也不例外。
 */
export const EXTORTION_GOLD = 100;

/**
 * 干扰牌：打出后先挑一名其他玩家，代价落在他身上。
 *
 * 都只有地图时机——战斗里选人会和攻防两侧的暗牌流程打架，而这些效果关心的是
 * 棋盘位置与身家，不是这一场交手。
 *
 * 每张牌上只能有一条 targetPlayer 效果：选择会暂停结算，排在它后面的走不到。
 */
export const INTERFERENCE_SCROLLS = {
  tripwire: {
    name: "绊索",
    description: "选定一名其他玩家，他下一次掷骰移动只能走 1 格",
    rarity: "N",
    timings: ["map"],
    effects: [{ type: "targetPlayer", apply: { type: "forceMovementRoll", value: 1 } }],
  },

  extortion: {
    name: "勒索信",
    description: `选定一名其他玩家，抢走他 ${EXTORTION_GOLD} 金币`,
    rarity: "R",
    timings: ["map"],
    effects: [{
      type: "targetPlayer",
      apply: { type: "stealGold", amount: EXTORTION_GOLD },
    }],
  },

  moonwalk: {
    name: "太空步",
    description: "选定一名其他玩家，让他沿环路后退 2 格",
    rarity: "R",
    timings: ["map"],
    effects: [{ type: "targetPlayer", apply: { type: "pushBack", distance: 2 } }],
  },

  bodySwap: {
    name: "移形换影",
    description: "代替本次掷骰：与同区域内的一名玩家交换位置，只有你会结算换到的新格子",
    rarity: "SR",
    timings: ["map"],
    effects: [{ type: "targetPlayer", apply: { type: "swapPositions" } }],
  },
} satisfies Record<string, ScrollDefinition>;
