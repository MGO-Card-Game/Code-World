import { describe, expect, it } from "vitest";
import { createInitialGame } from "../../engine";
import {
  getAttack,
  getDefense,
  getDiceCountBonus,
  getDieSidesBonus,
  getMaxHpBonus,
} from "../../selectors";
import { CARD_RARITY_ORDER, REWARD_RARITY_TIERS } from "../rarity";
import {
  EQUIPMENT,
  EQUIPMENT_BY_CATEGORY,
  EQUIPMENT_CATEGORY_NAMES,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
  pickEquipmentKind,
  type EquipmentCategory,
  type EquipmentDefinition,
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

  it("声明式属性修正都会通过统一 selector 生效", () => {
    for (const [kind, definition] of Object.entries(EQUIPMENT)) {
      const typedDefinition: EquipmentDefinition = definition;
      // 动态修正依赖战斗进度等上下文，由各自的行为测试覆盖。
      if (typedDefinition.effects?.modifiers) continue;

      const player = createInitialGame(1).players.player1;
      player.equipment = [{
        instanceId: `contract-${kind}`,
        kind: kind as EquipmentKind,
      }];
      const sum = (
        matches: (modifier: EquipmentDefinition["modifiers"][number]) => boolean,
      ) =>
        typedDefinition.modifiers
          .filter(matches)
          .reduce((total, modifier) => total + modifier.value, 0);

      for (const die of ["movement", "attack", "defense"] as const) {
        expect(getDieSidesBonus(player, die), `${kind}:${die}:dieSides`).toBe(
          sum((modifier) => modifier.type === "dieSides" && modifier.die === die),
        );
      }
      for (const die of ["attack", "defense"] as const) {
        expect(getDiceCountBonus(player, die), `${kind}:${die}:diceCount`).toBe(
          sum((modifier) => modifier.type === "diceCount" && modifier.die === die),
        );
      }
      expect(getAttack(player) - player.baseAttack, `${kind}:attack`).toBe(
        sum((modifier) => modifier.type === "statBonus" && modifier.stat === "attack"),
      );
      expect(getDefense(player) - player.baseDefense, `${kind}:defense`).toBe(
        sum((modifier) => modifier.type === "statBonus" && modifier.stat === "defense"),
      );
      expect(getMaxHpBonus(player), `${kind}:maxHp`).toBe(
        sum((modifier) => modifier.type === "maxHp"),
      );
    }
  });

  it("highQuality 档提高稀有档权重，并且只会抽到武器", () => {
    expect(REWARD_RARITY_TIERS.highQuality)
      .toEqual({ N: 20, R: 50, SR: 25, PR: 5 });

    // 票位 0.29 落在 [0.20, 0.70) 的 R 段——武器池四档齐全，权重即实际概率
    const rolls = [0.29, 0];
    const kind = pickEquipmentKind(
      () => rolls.shift() ?? 0,
      { category: "weapon", rarityWeights: REWARD_RARITY_TIERS.highQuality },
    );
    expect(EQUIPMENT[kind].rarity).toBe("R");
    expect(equipmentCategory(kind)).toBe("weapon");
  });
});
