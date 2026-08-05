import type { EquipmentModifier } from "../effects/cardEffects";
import { pickByRarity, type CardRarity } from "./rarity";

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

export interface EquipmentDefinition {
  name: string;
  description: string;
  rarity: CardRarity;
  category: EquipmentCategory;
  modifiers: readonly EquipmentModifier[];
  /** 通用 modifier 不够时，按生命周期调用具名代码解析器。 */
  customResolver?: string;
}

/** 装备展示配置；具体属性联动由装备效果解析逻辑负责。 */
export const EQUIPMENT = {
  sword: {
    name: "铁剑",
    description: "攻击永久 +1",
    rarity: "N",
    category: "weapon",
    modifiers: [{ type: "statBonus", stat: "attack", value: 1 }],
  },
  shield: {
    name: "木盾",
    description: "防御永久 +1",
    rarity: "N",
    category: "armor",
    modifiers: [{ type: "statBonus", stat: "defense", value: 1 }],
  },
  charm: {
    name: "生命护符",
    description: "生命上限 +4，获得时恢复 4",
    rarity: "R",
    category: "accessory",
    modifiers: [{ type: "maxHp", value: 4 }],
  },
  borderLeather: {
    name: "边境皮甲",
    description: "防御骰上限 +1（D6 → D7）",
    rarity: "N",
    category: "armor",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
  },
  travelerBoots: {
    name: "旅行者短靴",
    description: "地图移动骰上限 +1（D6 → D7）",
    rarity: "N",
    category: "shoes",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
  },
} satisfies Record<string, EquipmentDefinition>;

/** 直接由配置键推导；新增装备时无需再维护另一份字符串联合类型。 */
export type EquipmentKind = keyof typeof EQUIPMENT;

export function equipmentDefinition(kind: EquipmentKind): EquipmentDefinition {
  return EQUIPMENT[kind];
}

export function equipmentCategory(kind: EquipmentKind) {
  return EQUIPMENT[kind].category;
}

export function pickEquipmentKind(random: () => number): EquipmentKind {
  const kinds = Object.keys(EQUIPMENT) as EquipmentKind[];
  return pickByRarity(kinds, (kind) => EQUIPMENT[kind].rarity, random);
}
