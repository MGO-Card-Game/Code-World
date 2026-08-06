import type { ScrollDefinition } from "./definition";

/** 骰子强化类：直接改本次投骰的骰面、骰数或结果。 */
export const DICE_BOOST_SCROLLS = {
  fate: {
    name: "D20",
    description: "本次攻击或防御骰由 D6 变为 D20",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "dieSides", sides: 20 }],
  },

  loadedDicePool: {
    name: "满载骰池",
    description: "本次攻或防额外投 2 个骰子，结果求和",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "extraDice", count: 2 }],
  },

  /*
    命运王冠（饰品·PR）在每场战斗开始时发一张这个，战斗结束回收。

    「每场战斗一次 + 自己挑时机」就此完全落在已有的选牌阶段上：一场只发一张，
    打掉就没了，暗牌与联机归属也照旧。代价则来自 8.5——每方每回合最多一张卷轴，
    用王冠的那一轮就打不了 D20 或巨龙打击。

    drawable: false 是关键，否则宝箱和战斗奖励会把它当普通卷轴发出去。
  */
  fateCrownDecree: {
    name: "命运王冠",
    description: "本场战斗限定 · 本次攻或防的第一颗骰直接视为最高面",
    rarity: "PR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "maxRoll", count: 1 }],
    drawable: false,
  },
} satisfies Record<string, ScrollDefinition>;
