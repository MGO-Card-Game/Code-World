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
} satisfies Record<string, ScrollDefinition>;
