import type { ScrollDefinition } from "./definition";

/** 攻防转换类：改攻防数值、伤害下限，或者绕过投骰直接结算。 */
export const COMBAT_SWING_SCROLLS = {
  might: {
    name: "力量卷轴",
    description: "本次攻击 +3",
    rarity: "N",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },

  guard: {
    name: "护盾卷轴",
    description: "本次防御 +3",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },

  dragonStrike: {
    name: "巨龙打击",
    description: "掷骰前造成 7 点伤害，减去其当前防御",
    rarity: "R",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "directDamage", amount: 7 }],
  },

  ironWallOrder: {
    name: "铁壁令",
    description: "本次防御中，每个防御骰最低视为 3",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "minimumRoll", value: 3 }],
  },
} satisfies Record<string, ScrollDefinition>;
