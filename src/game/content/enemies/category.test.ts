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
  ROAMING_AFFIX_CHANCE,
  eliteAffixDefinition,
  enemyDefinition,
  enemyTier,
  hasRegionPool,
  pickEliteEnemy,
  pickRoamingEnemy,
  pickTileEnemyEncounter,
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

  it("每只怪都有名字、正数的攻血和非负防御", () => {
    for (const definition of Object.values(ENEMIES)) {
      expect(definition.name).toBeTruthy();
      expect(definition.maxHp).toBeGreaterThan(0);
      expect(definition.attack).toBeGreaterThan(0);
      expect(definition.defense).toBeGreaterThanOrEqual(0);
    }
  });

  it("会随机投放的档位都声明了区域权重，boss 档不声明", () => {
    for (const tier of ["roaming", "elite"] as const) {
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

  it("怪物不配置奖励种类——非 Boss 战统一随机，Boss 击败即胜利", () => {
    for (const tier of ["roaming", "elite", "boss"] as const) {
      for (const kind of kindsOf(tier)) {
        expect("reward" in enemyDefinition(kind)).toBe(false);
      }
    }
  });

  it("声明的玩家可见能力都有名字和说明，三个阶段首领都提供情报", () => {
    for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
      const definition = enemyDefinition(kind);
      for (const ability of definition.abilities ?? []) {
        expect(ability.name).toBeTruthy();
        expect(ability.description).toBeTruthy();
      }
    }
    for (const region of MAP_REGIONS) {
      expect(enemyDefinition(region.bossEnemyId).abilities?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("每个区域都有漫游怪可投放——空池会让抽取直接抛", () => {
    for (const region of REGIONS) {
      expect(hasRegionPool("roaming", region as MapRegionId)).toBe(true);
    }
  });

  it("每个区域都有独立精英怪可投放", () => {
    for (const region of REGIONS) {
      expect(hasRegionPool("elite", region as MapRegionId)).toBe(true);
    }
  });

  it("三段路线按声明权重抽取不同的漫游怪组合", () => {
    const pickAt = (region: MapRegionId, ticket: number) =>
      pickRoamingEnemy(region, () => ticket);

    expect([0.1, 0.4, 0.55, 0.75, 0.95].map((ticket) => pickAt("foothill", ticket)))
      .toEqual(["slime", "wolf", "caveBats", "thornbackBoar", "bioSlug"]);
    expect([0.1, 0.3, 0.45, 0.55, 0.7, 0.8, 0.95]
      .map((ticket) => pickAt("mountainside", ticket)))
      .toEqual([
        "wolf", "golem", "thornbackBoar", "mistSpider", "thunderEagle",
        "bioSlug", "ragingBear",
      ]);
    expect([0.05, 0.2, 0.38, 0.5, 0.6, 0.72, 0.82, 0.95]
      .map((ticket) => pickAt("summit", ticket)))
      .toEqual([
        "wolf", "golem", "mistSpider", "thunderEagle", "iceShellLizard",
        "uncannyFlesh", "bioSlug", "ragingBear",
      ]);
  });

  it("三段路线从独立精英池抽取，不会退回漫游怪", () => {
    const pickAt = (region: MapRegionId, ticket: number) =>
      pickEliteEnemy(region, () => ticket);

    expect([0.1, 0.8].map((ticket) => pickAt("foothill", ticket)))
      .toEqual(["razorbackAlpha", "mireHexer"]);
    expect([0.1, 0.4, 0.9].map((ticket) => pickAt("mountainside", ticket)))
      .toEqual(["mireHexer", "cliffOgre", "frostWraith"]);
    expect([0.1, 0.3, 0.65, 0.95].map((ticket) => pickAt("summit", ticket)))
      .toEqual(["frostWraith", "watcherWyvern", "thunderRoc", "obsidianSentinel"]);
  });

  it("踩格遭遇集中执行漫游词条概率与精英档位规则", () => {
    expect(ROAMING_AFFIX_CHANCE).toBeGreaterThan(0);
    expect(ROAMING_AFFIX_CHANCE).toBeLessThan(1);

    const affixedTickets = [0, ROAMING_AFFIX_CHANCE / 2, 0, 0];
    const affixed = pickTileEnemyEncounter(
      "battle",
      "foothill",
      () => affixedTickets.shift() ?? 0,
    );
    expect(enemyTier(affixed.enemyId)).toBe("roaming");
    expect(affixed.enemyAffix).toBeDefined();

    const plainTickets = [0, ROAMING_AFFIX_CHANCE];
    const plain = pickTileEnemyEncounter(
      "battle",
      "foothill",
      () => plainTickets.shift() ?? 0,
    );
    expect(enemyTier(plain.enemyId)).toBe("roaming");
    expect(plain.enemyAffix).toBeUndefined();

    const elite = pickTileEnemyEncounter("elite", "foothill", () => 0);
    expect(enemyTier(elite.enemyId)).toBe("elite");
    expect(elite.enemyAffix).toBeUndefined();
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
