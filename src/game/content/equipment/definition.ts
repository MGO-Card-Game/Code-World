import type { StatModifier } from "../../effects/battleHooks";
import type { EquipmentEffects } from "../../effects/cardEffects";
import { orderKeywords, type KeywordKind } from "../keywords";
import type { CardRarity } from "../rarity";

export type EquipmentCategory = "weapon" | "armor" | "shoes" | "accessory";

export const EQUIPMENT_SLOT_LIMITS: Record<EquipmentCategory, number> = {
  weapon: 1,
  armor: 1,
  shoes: 1,
  accessory: 2,
};

export const EQUIPMENT_CATEGORY_NAMES: Record<EquipmentCategory, string> = {
  weapon: "武器",
  armor: "防具",
  shoes: "鞋具",
  accessory: "饰品",
};

/**
 * 一张装备卡的内容。
 *
 * 这里没有 category——它由所在的分类表盖章，见 defineEquipment。
 */
export interface EquipmentBody {
  name: string;
  description: string;
  rarity: CardRarity;
  modifiers: readonly StatModifier[];
  /**
   * 牌面关键字。
   *
   * 装备这边全靠手写：效果都住在 `effects` 的函数体里，静态看不出装备到底做了
   * 什么——卷轴那种"读一遍 effects 数组就知道"的推导在这里不成立。
   */
  keywords?: readonly KeywordKind[];
  /**
   * 通用 modifier 表达不了的逻辑直接写在这里。
   *
   * 卡牌定义只活在模块常量里，GameState 只保存 { instanceId, kind }，
   * 所以放函数不影响存档、重放和联机同步。
   */
  effects?: EquipmentEffects;
}

export type EquipmentDefinition = EquipmentBody & { category: EquipmentCategory };

/** 牌面该印哪些关键字。装备没有可推导的部分，只是排成和卷轴一致的顺序。 */
export function equipmentKeywords(definition: EquipmentBody): KeywordKind[] {
  return orderKeywords(definition.keywords ?? []);
}

/**
 * 给一整张分类表盖上 category。
 *
 * 分类写在文件层面而不是每张卡上：卡片各自声明 category 时，它可以和所在文件
 * 对不上；盖章之后这种漂移在结构上就不存在了。新增一个分类 = 新建一个表文件，
 * 再在 index 里合并进来。
 */
export function defineEquipment<
  C extends EquipmentCategory,
  T extends Record<string, EquipmentBody>,
>(category: C, table: T): { [K in keyof T]: T[K] & { category: C } } {
  return Object.fromEntries(
    Object.entries(table).map(([kind, body]) => [kind, { ...body, category }]),
  ) as { [K in keyof T]: T[K] & { category: C } };
}
