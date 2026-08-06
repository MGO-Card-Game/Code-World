import { CARD_RARITY_WEIGHTS, pickByRarity } from "../rarity";
import { COMBAT_SWING_SCROLLS } from "./combatSwing";
import type { ScrollDefinition } from "./definition";
import { DICE_BOOST_SCROLLS } from "./diceBoost";

export {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  scrollCategory,
} from "./definition";
export type { ScrollCategory, ScrollDefinition, ScrollRarity } from "./definition";

/** 先按稀有度抽取，再在同稀有度的所有卷轴中等概率抽取。 */
export const SCROLL_RARITY_WEIGHTS = CARD_RARITY_WEIGHTS;

/** 按效果主题分组保留一份，便于按组遍历。 */
export const SCROLLS_BY_GROUP = {
  diceBoost: DICE_BOOST_SCROLLS,
  combatSwing: COMBAT_SWING_SCROLLS,
} as const satisfies Record<string, Record<string, ScrollDefinition>>;

/**
 * 全部卷轴。GameRule 8.8 还规划了精准、坚守、狂暴、闪避等，
 * 新增一张卡只要改对应的主题表，这里不用动。
 *
 * 各主题表之间的键必须互不重复，否则展开时后者会静默覆盖前者；
 * scrolls.test.ts 里有一条数量断言守着这件事。
 */
export const SCROLLS = {
  ...DICE_BOOST_SCROLLS,
  ...COMBAT_SWING_SCROLLS,
};

/** 直接由配置键推导；新增卷轴时无需再维护另一份字符串联合类型。 */
export type ScrollKind = keyof typeof SCROLLS;

export function scrollDefinition(kind: ScrollKind): ScrollDefinition {
  return SCROLLS[kind];
}

export function pickScrollKind(random: () => number): ScrollKind {
  const kinds = Object.keys(SCROLLS) as ScrollKind[];
  return pickByRarity(kinds, (kind) => SCROLLS[kind].rarity, random);
}
