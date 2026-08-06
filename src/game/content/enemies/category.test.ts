import { describe, expect, it } from "vitest";
import { MAP_REGIONS } from "../../map";
import type { MapRegionId } from "../../types";
import { CARD_RARITY_ORDER } from "../rarity";
import {
  ELITE_AFFIXES,
  ELITE_BASE_MODIFIERS,
  ENEMIES,
  ENEMIES_BY_TIER,
  ENEMY_TIER_NAMES,
  eliteAffixDefinition,
  enemyDefinition,
  enemyTier,
  hasRegionPool,
  type EliteAffixKind,
  type EnemyKind,
  type EnemyTier,
} from "./index";

const TIERS = Object.keys(ENEMIES_BY_TIER) as EnemyTier[];
const REGIONS = MAP_REGIONS.map((region) => region.id);

/*
  一律经访问器取值，别直接读档位表。

  ENEMIES 的字面量类型里，没写 regions / reward / effects 的那几只怪
  根本没有这些属性，直接读会是编译错误——卷轴的 drawableScrollKinds
  为同一件事留过一条注释。
*/
function kindsOf(tier: EnemyTier) {
  return Object.keys(ENEMIES_BY_TIER[tier]) as EnemyKind[];
}

describe("怪物档位表", () => {
  it("合并后不丢怪——档位表之间不能有重名的 kind", () => {
    // 展开合并时后者会静默覆盖前者，数量对不上就是撞键了
    const partsTotal = TIERS.reduce(
      (sum, tier) => sum + Object.keys(ENEMIES_BY_TIER[tier]).length,
      0,
    );
    expect(Object.keys(ENEMIES)).toHaveLength(partsTotal);
  });

  it("每只怪的 tier 就是它所在的表，不用自己声明", () => {
    for (const tier of TIERS) {
      for (const kind of Object.keys(ENEMIES_BY_TIER[tier])) {
        expect(enemyTier(kind as EnemyKind)).toBe(tier);
      }
    }
  });

  it("三个档位都有中文名", () => {
    expect(TIERS.sort()).toEqual(
      (Object.keys(ENEMY_TIER_NAMES) as EnemyTier[]).sort(),
    );
  });

  it("每只怪都有名字和正数的攻防血", () => {
    for (const definition of Object.values(ENEMIES)) {
      expect(definition.name).toBeTruthy();
      expect(definition.maxHp).toBeGreaterThan(0);
      expect(definition.attack).toBeGreaterThan(0);
      expect(definition.defense).toBeGreaterThan(0);
    }
  });

  it("会随机投放的档位都声明了区域权重，boss 档不声明", () => {
    for (const tier of ["roaming", "apex"] as const) {
      for (const kind of kindsOf(tier)) {
        const weights = Object.values(enemyDefinition(kind).regions ?? {});
        expect(weights.length, `${kind} 没有声明区域`).toBeGreaterThan(0);
        for (const weight of weights) expect(weight).toBeGreaterThan(0);
      }
    }
    for (const kind of kindsOf("boss")) {
      // Boss 位置固定，声明区域权重只会让人以为它会随机刷出来
      expect(enemyDefinition(kind).regions).toBeUndefined();
    }
  });

  it("boss 档不带 reward——击败即胜利，那个字段永远读不到", () => {
    for (const kind of kindsOf("boss")) {
      expect(enemyDefinition(kind).reward).toBeUndefined();
    }
    for (const kind of [...kindsOf("roaming"), ...kindsOf("apex")]) {
      expect(["scroll", "equipment"]).toContain(enemyDefinition(kind).reward);
    }
  });

  it("每个区域都有漫游怪可投放——空池会让抽取直接抛", () => {
    for (const region of REGIONS) {
      expect(hasRegionPool("roaming", region as MapRegionId)).toBe(true);
    }
  });

  it("精英词缀都有名字、描述、合法稀有度和 modifiers 数组", () => {
    for (const definition of Object.values(ELITE_AFFIXES)) {
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(CARD_RARITY_ORDER).toContain(definition.rarity);
      expect(Array.isArray(definition.modifiers)).toBe(true);
    }
  });

  it("每条词缀都真的做了点什么——modifiers 和 effects 不能同时为空", () => {
    for (const kind of Object.keys(ELITE_AFFIXES) as EliteAffixKind[]) {
      const definition = eliteAffixDefinition(kind);
      const doesSomething = definition.modifiers.length > 0
        || definition.effects !== undefined;
      expect(doesSomething, `${kind} 是一条空词缀`).toBe(true);
    }
  });

  it("精英基础强化至少抬高血量，精英才不会只是换个名字", () => {
    /*
      攻防有意留给词缀：攻防差配上 d6，基础再 +1 攻 +1 防会让基础玩家
      对精英山狼的胜率从 55% 掉到 3%。血量是唯一能线性加难度的旋钮。
    */
    const hp = ELITE_BASE_MODIFIERS.filter((modifier) => modifier.type === "maxHp");
    expect(hp).toHaveLength(1);
    expect(hp[0].value).toBeGreaterThan(0);
  });
});
