import { describe, expect, it } from "vitest";
import { CARD_RARITY_ORDER } from "../rarity";
import {
  EQUIPMENT,
  EQUIPMENT_BY_CATEGORY,
  EQUIPMENT_CATEGORY_NAMES,
  EQUIPMENT_SLOT_LIMITS,
  HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS,
  equipmentCategory,
  pickEquipmentKind,
  type EquipmentCategory,
  type EquipmentKind,
} from "./index";

const CATEGORIES = Object.keys(EQUIPMENT_BY_CATEGORY) as EquipmentCategory[];

describe("装备分类表", () => {
  it("合并后不丢卡——分类表之间不能有重名的 kind", () => {
    // 展开合并时后者会静默覆盖前者，数量对不上就是撞键了
    const partsTotal = CATEGORIES.reduce(
      (sum, category) => sum + Object.keys(EQUIPMENT_BY_CATEGORY[category]).length,
      0,
    );
    expect(Object.keys(EQUIPMENT)).toHaveLength(partsTotal);
  });

  it("每张卡的 category 就是它所在的表，不用自己声明", () => {
    for (const category of CATEGORIES) {
      for (const kind of Object.keys(EQUIPMENT_BY_CATEGORY[category])) {
        expect(equipmentCategory(kind as EquipmentKind)).toBe(category);
      }
    }
  });

  it("四个分类都有槽位上限和中文名", () => {
    for (const category of CATEGORIES) {
      expect(EQUIPMENT_SLOT_LIMITS[category]).toBeGreaterThan(0);
      expect(EQUIPMENT_CATEGORY_NAMES[category]).toBeTruthy();
    }
    // 反过来也要成立：加了槽位配置却忘了建表，抽卡池会漏掉整个分类
    expect(CATEGORIES.sort()).toEqual(
      (Object.keys(EQUIPMENT_SLOT_LIMITS) as EquipmentCategory[]).sort(),
    );
  });

  it("每张卡都声明了稀有度和修正列表", () => {
    for (const definition of Object.values(EQUIPMENT)) {
      expect(CARD_RARITY_ORDER).toContain(definition.rarity);
      expect(Array.isArray(definition.modifiers)).toBe(true);
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
    }
  });

  it("高品质武器池提高稀有档权重，并且只会抽到武器", () => {
    expect(HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS)
      .toEqual({ N: 20, R: 50, SR: 25, PR: 5 });

    const rolls = [0.29, 0];
    const kind = pickEquipmentKind(
      () => rolls.shift() ?? 0,
      { category: "weapon", rarityWeights: HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS },
    );
    // 当前武器只有 N/R 两档，空档不参与后，R 的实际概率为 50/(20+50)。
    expect(EQUIPMENT[kind].rarity).toBe("R");
    expect(equipmentCategory(kind)).toBe("weapon");
  });
});
