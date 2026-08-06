import { pickByRarity } from "../rarity";
import { ACCESSORIES } from "./accessories";
import { ARMOR } from "./armor";
import type { EquipmentCategory, EquipmentDefinition } from "./definition";
import { SHOES } from "./shoes";
import { WEAPONS } from "./weapons";

export {
  EQUIPMENT_CATEGORY_NAMES,
  EQUIPMENT_SLOT_LIMITS,
  defineEquipment,
} from "./definition";
export type {
  EquipmentBody,
  EquipmentCategory,
  EquipmentDefinition,
} from "./definition";

/** 分类表原样保留一份，便于按分类遍历（调试面板、卡池分析都用得上）。 */
export const EQUIPMENT_BY_CATEGORY = {
  weapon: WEAPONS,
  armor: ARMOR,
  shoes: SHOES,
  accessory: ACCESSORIES,
} as const satisfies Record<EquipmentCategory, Record<string, EquipmentDefinition>>;

/**
 * 全部装备。新增一张卡只要改对应的分类表，这里不用动。
 *
 * 分类表之间的键必须互不重复，否则展开时后者会静默覆盖前者；
 * equipment.test.ts 里有一条数量断言守着这件事。
 */
export const EQUIPMENT = {
  ...WEAPONS,
  ...ARMOR,
  ...SHOES,
  ...ACCESSORIES,
};

/** 直接由配置键推导；新增装备时无需再维护另一份字符串联合类型。 */
export type EquipmentKind = keyof typeof EQUIPMENT;

export function equipmentDefinition(kind: EquipmentKind): EquipmentDefinition {
  return EQUIPMENT[kind];
}

export function equipmentCategory(kind: EquipmentKind): EquipmentCategory {
  return EQUIPMENT[kind].category;
}

export function pickEquipmentKind(random: () => number): EquipmentKind {
  const kinds = Object.keys(EQUIPMENT) as EquipmentKind[];
  return pickByRarity(kinds, (kind) => EQUIPMENT[kind].rarity, random);
}
