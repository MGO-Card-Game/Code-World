import type { ScrollTiming } from "../types";
import type { ScrollEffectDefinition } from "../effects/cardEffects";
import {
  CARD_RARITY_WEIGHTS,
  pickByRarity,
  type CardRarity,
} from "./rarity";

export type ScrollRarity = CardRarity;

/** 先按稀有度抽取，再在同稀有度的所有卷轴中等概率抽取。 */
export const SCROLL_RARITY_WEIGHTS = CARD_RARITY_WEIGHTS;

export interface ScrollDefinition {
  name: string;
  description: string;
  sigil: string;
  rarity: ScrollRarity;
  /** 可以在哪些时机打出；通用卷轴可以同时属于攻防两个时机。 */
  timings: readonly ScrollTiming[];
  effects: readonly ScrollEffectDefinition[];
}

/**
 * 已实现的卷轴。GameRule 8.8 还规划了精准、坚守、狂暴、闪避四种；
 * 新效果仍需在战斗效果解析器中实现，显示与使用时机由这里维护。
 */
export const SCROLLS = {
  might: {
    name: "力量卷轴",
    description: "本次攻击 +3",
    sigil: "攻",
    rarity: "N",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },
  guard: {
    name: "护盾卷轴",
    description: "本次防御 +3",
    sigil: "守",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },
  fate: {
    name: "D20",
    description: "本次攻击或防御骰由 D6 变为 D20",
    sigil: "通",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "dieSides", sides: 20 }],
  },
  dragonStrike: {
    name: "巨龙打击",
    description: "掷骰前造成 7 点伤害，减去其当前防御",
    sigil: "龙",
    rarity: "R",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "directDamage", amount: 7 }],
  },
  ironWallOrder: {
    name: "铁壁令",
    description: "本次防御中，每个防御骰最低视为 3",
    sigil: "壁",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "minimumRoll", value: 3 }],
  },
  loadedDicePool: {
    name: "满载骰池",
    description: "本次攻或防额外投 2 个骰子，结果求和",
    sigil: "叠",
    rarity: "R",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "extraDice", count: 2 }],
  },
} satisfies Record<string, ScrollDefinition>;

/** 直接由配置键推导；新增卷轴时无需再维护另一份字符串联合类型。 */
export type ScrollKind = keyof typeof SCROLLS;

export function scrollDefinition(kind: ScrollKind): ScrollDefinition {
  return SCROLLS[kind];
}

export function pickScrollKind(random: () => number): ScrollKind {
  const kinds = Object.keys(SCROLLS) as ScrollKind[];
  return pickByRarity(kinds, (kind) => SCROLLS[kind].rarity, random);
}
