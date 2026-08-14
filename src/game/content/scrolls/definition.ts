import type { ScrollEffectDefinition } from "../../effects/cardEffects";
import type { BattleState, ScrollTiming } from "../../types";
import { orderKeywords, type KeywordKind } from "../keywords";
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
   * 牌面关键字里必须手写的那部分。
   *
   * 能从 effects 或别的字段看出来的一律不写在这里——`scrollKeywords()` 会补上，
   * 手写只会多出一处能和实际不符的地方（category 从 timings 推导、装备 category
   * 由文件盖章，都是同一条判据）。真正需要声明的是藏在 `custom` 函数体里、
   * 静态看不见的那些，比如往 `bonusDamage` 上加数的牌。
   */
  keywords?: readonly KeywordKind[];
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
/**
 * 从 effects 就能看出来的那些关键字。
 *
 * 都是声明式效果类型，读一遍数组即可，不必让卡自己写——写了就可能和 effects 对不上。
 * 「走」和「跳」的区别（advanceTiles 逐格 vs teleport 只结算落点）在这里第一次
 * 变成牌面上看得见的东西，此前它只活在 cardEffects.ts 的注释里。
 */
function derivedScrollKeywords(definition: ScrollDefinition): KeywordKind[] {
  const derived: KeywordKind[] = [];
  for (const effect of definition.effects) {
    switch (effect.type) {
      case "directDamage":
      case "mutualDirectDamage":
        derived.push("directDamage");
        break;
      case "chooseMovement":
      case "advanceTiles":
      case "returnToCamp":
      case "returnToPreviousPosition":
        derived.push("replacesMovement");
        break;
      case "teleport":
      case "teleportAnywhere":
        derived.push("replacesMovement", "skipsPath");
        break;
      case "targetPlayer":
        derived.push("needsTarget");
        // 换位与主动邀战都会吃掉本次移动机会，其余目标效果只是对别人动手
        if (effect.apply.type === "swapPositions") {
          derived.push("replacesMovement", "skipsPath");
        } else if (effect.apply.type === "startPvpBattle") {
          derived.push("replacesMovement");
        }
        break;
    }
  }
  return derived;
}

/** 牌面该印哪些关键字：手写的加推导出来的，排成固定顺序。 */
export function scrollKeywords(definition: ScrollDefinition): KeywordKind[] {
  return orderKeywords([
    ...(definition.keywords ?? []),
    ...derivedScrollKeywords(definition),
  ]);
}

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
