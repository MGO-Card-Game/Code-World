import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGodotContentCatalog, serializeGodotContentCatalog } from "../../scripts/export-godot-catalog";
import { ENEMIES, type EnemyKind } from "../../src/game/content/enemies";
import { KEYWORDS } from "../../src/game/content/keywords";
import { CARD_RARITY_ORDER } from "../../src/game/content/rarity";
import { ECONOMY } from "../../src/game/economy";
import { STAT_GROWTH } from "../../src/game/growth";
import { enemyDiceCountBonus, enemyDieSidesBonus } from "../../src/game/selectors";

describe("Godot content catalog", () => {
  it("matches the checked-in UTF-8 bytes", () => {
    const file = new URL("../../godot/data/content_catalog.json", import.meta.url);
    expect(readFileSync(file).equals(Buffer.from(serializeGodotContentCatalog(), "utf8"))).toBe(true);
  });

  it("exports the ordered public vocabulary and M1 content", () => {
    const catalog = buildGodotContentCatalog();
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.rarities).toEqual(CARD_RARITY_ORDER);
    expect(catalog.keywordOrder).toEqual(Object.keys(KEYWORDS));
    expect(catalog.keywords.ignoreDefense.label).toBe(KEYWORDS.ignoreDefense.label);
    expect(Object.values(catalog.scrolls).filter((s) => s.group === "interference")).toHaveLength(8);
    expect(Object.values(catalog.enemies).filter((e) => e.tier === "boss")).toHaveLength(3);
    for (const table of [catalog.equipment, catalog.blessings, catalog.mapEvents, catalog.ruleTerms, catalog.eliteAffixes]) {
      expect(Object.keys(table).length).toBeGreaterThan(0);
    }
    expect(serializeGodotContentCatalog()).not.toMatch(/"engine"\s*:/);
  });

  it("publishes permanent growth and camp prices", () => {
    const { statGrowth, campShop } = buildGodotContentCatalog();
    expect(statGrowth).toEqual(STAT_GROWTH);
    expect(campShop).toEqual({
      scrollPrice: ECONOMY.shop.scroll.price, healingPrice: ECONOMY.shop.healing.price,
      healingAmount: ECONOMY.shop.healing.amount,
    });
  });

  it("distinguishes configurable movement from other effects that replace or forfeit it", () => {
    const { scrolls } = buildGodotContentCatalog();
    expect(scrolls.remoteDice.mapConfig).toBe("chooseMovement");
    expect(scrolls.anywhereDoor.mapConfig).toBe("teleportAnywhere");
    expect(scrolls.shortRangeTeleportCharm).toMatchObject({ mapConfig: "teleport", teleportMaxDistance: 3 });
    expect(scrolls.withinReach).toMatchObject({ mapConfig: "teleport", teleportMaxDistance: 1 });
    expect(scrolls.retrace).toMatchObject({ mapConfig: "none", retracesPosition: true, replacesMovement: true });
    expect(scrolls.bodySwap).toMatchObject({ mapConfig: "none", replacesMovement: true });
    expect(scrolls.battlefieldMedicine).toMatchObject({ healsHp: true, forfeitsMovement: true });
    expect(scrolls.firstAidBandage).toMatchObject({ healsHp: true, forfeitsMovement: false });
    expect(scrolls.might).toMatchObject({ mapConfig: "none", healsHp: false, forfeitsMovement: false,
      replacesMovement: false, retracesPosition: false });
    for (const entry of Object.values(scrolls)) {
      if (entry.mapConfig !== "teleport") expect(entry.teleportMaxDistance).toBeNull();
    }
  });

  it("publishes both unmodified-by-affix combat dice for every enemy", () => {
    const { enemies } = buildGodotContentCatalog();
    for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
      for (const die of ["attack", "defense"] as const) {
        expect(enemies[kind][`${die}Dice`]).toBe(1 + enemyDiceCountBonus(kind, undefined, die));
        expect(enemies[kind][`${die}Sides`]).toBe(6 + enemyDieSidesBonus(kind, undefined, die));
      }
    }
  });
});
