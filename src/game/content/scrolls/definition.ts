import type { ScrollEffectDefinition } from "../../effects/cardEffects";
import type { BattleState, ScrollTiming } from "../../types";
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
   * 战斗里的使用对象限制：timings 管什么时候能打，这条管能打给谁。
   *
   * 不配表示不挑对手。返回 false 的战斗里这张牌根本不进可选列表，
   * 而不是打出去之后静默失效——挑对象的牌若能被当废牌交掉，
   * 玩家迟早会在没读懂条件时白扔一张 R。
   */
  usableAgainst?: (
    battle: Pick<BattleState, "kind" | "enemyId" | "enemyAffix">,
  ) => boolean;
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
export type ScrollCategory = "attack" | "defense" | "universal" | "healing";

export const SCROLL_CATEGORY_NAMES: Record<ScrollCategory, string> = {
  attack: "攻击牌",
  defense: "防守牌",
  universal: "通用牌",
  healing: "疗牌",
};

/** 圆圈里的单字，取类型名的首字，和战斗界面的"攻击／防御"两栏对得上。 */
export const SCROLL_CATEGORY_SIGILS: Record<ScrollCategory, string> = {
  attack: "攻",
  defense: "防",
  universal: "通",
  healing: "疗",
};

/**
 * 疗牌由 heal 效果识别；其余卡牌由 timings 推导，不另外配置。
 *
 * 这样疗牌可以同时拥有地图、攻击和防御时机，却仍显示独立的「疗」标识；
 * 其他牌继续由使用时机自然分成攻、防、通。
 */
export function scrollCategory(definition: ScrollDefinition): ScrollCategory {
  if (definition.effects.some((effect) => effect.type === "heal")) return "healing";
  const attack = definition.timings.includes("beforeAttackRoll");
  const defense = definition.timings.includes("beforeDefenseRoll");
  if (attack && defense) return "universal";
  if (attack) return "attack";
  if (defense) return "defense";
  // 纯地图卷轴（比如移动类）不攻不防，归到通用最贴切
  return "universal";
}
