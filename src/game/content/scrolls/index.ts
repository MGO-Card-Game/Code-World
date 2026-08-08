import { CARD_RARITY_WEIGHTS, pickByRarity } from "../rarity";
import { COMBAT_SWING_SCROLLS } from "./combatSwing";
import type { ScrollDefinition } from "./definition";
import { DICE_BOOST_SCROLLS } from "./diceBoost";
import { MOVEMENT_SCROLLS } from "./movement";
import { RECOVERY_SCROLLS } from "./recovery";

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
  recovery: RECOVERY_SCROLLS,
  movement: MOVEMENT_SCROLLS,
} as const satisfies Record<string, Record<string, ScrollDefinition>>;

/**
 * 全部卷轴。新增一张卡只要改对应的主题表，这里不用动。
 *
 * 各主题表之间的键必须互不重复，否则展开时后者会静默覆盖前者；
 * scrolls.test.ts 里有一条数量断言守着这件事。
 */
export const SCROLLS = {
  ...DICE_BOOST_SCROLLS,
  ...COMBAT_SWING_SCROLLS,
  ...RECOVERY_SCROLLS,
  ...MOVEMENT_SCROLLS,
};

/** 直接由配置键推导；新增卷轴时无需再维护另一份字符串联合类型。 */
export type ScrollKind = keyof typeof SCROLLS;

export function scrollDefinition(kind: ScrollKind): ScrollDefinition {
  return SCROLLS[kind];
}

/** 会出现在随机卡池里的卷轴。装备发的临时牌不在其中。 */
export function drawableScrollKinds(): ScrollKind[] {
  // 走 scrollDefinition 取值：SCROLLS 的字面量类型里，没写 drawable 的卡就没有这个属性
  return (Object.keys(SCROLLS) as ScrollKind[])
    .filter((kind) => scrollDefinition(kind).drawable !== false);
}

export function pickScrollKind(random: () => number): ScrollKind {
  return pickByRarity(drawableScrollKinds(), (kind) => SCROLLS[kind].rarity, random);
}
