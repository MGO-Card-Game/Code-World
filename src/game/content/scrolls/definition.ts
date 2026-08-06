import type { ScrollEffectDefinition } from "../../effects/cardEffects";
import type { ScrollTiming } from "../../types";
import type { CardRarity } from "../rarity";

export type ScrollRarity = CardRarity;

export interface ScrollDefinition {
  name: string;
  description: string;
  rarity: ScrollRarity;
  /** 可以在哪些时机打出；通用卷轴可以同时属于攻防两个时机。 */
  timings: readonly ScrollTiming[];
  /**
   * 是否参与随机卡池。默认参与。
   *
   * 只有特定来源才能拿到的牌（比如装备在战斗开始时发的临时牌）要设成 false，
   * 否则宝箱和战斗奖励会把它当普通卷轴发出去。
   */
  drawable?: boolean;
  /**
   * 引擎按数组顺序结算。
   *
   * 无法声明式表达的效果用 `{ type: "custom", resolve }` 直接写函数——
   * 卡牌定义只活在模块常量里，GameState 只保存 { instanceId, kind }。
   */
  effects: readonly ScrollEffectDefinition[];
}

/**
 * 牌面上标的卡牌类型。
 *
 * 注意这和卷轴的文件分组是两个维度：文件按效果主题分（骰子强化、攻防转换……），
 * 类型则永远由 timings 推导，不参与文件组织。
 */
export type ScrollCategory = "attack" | "defense" | "universal";

export const SCROLL_CATEGORY_NAMES: Record<ScrollCategory, string> = {
  attack: "攻击牌",
  defense: "防守牌",
  universal: "通用牌",
};

/** 圆圈里的单字，取类型名的首字，和战斗界面的"攻击／防御"两栏对得上。 */
export const SCROLL_CATEGORY_SIGILS: Record<ScrollCategory, string> = {
  attack: "攻",
  defense: "防",
  universal: "通",
};

/**
 * 卡牌类型直接由 timings 推导，不另外配置。
 *
 * 牌面上标的就是"这张牌什么时候能打"，而这件事 timings 已经说全了；
 * 再手写一份就多出一处可以和它对不上的地方。
 */
export function scrollCategory(definition: ScrollDefinition): ScrollCategory {
  const attack = definition.timings.includes("beforeAttackRoll");
  const defense = definition.timings.includes("beforeDefenseRoll");
  if (attack && defense) return "universal";
  return attack ? "attack" : "defense";
}
