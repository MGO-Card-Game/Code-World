import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGodotContentCatalog, serializeGodotContentCatalog } from "../../scripts/export-godot-catalog";
import { KEYWORDS } from "../../src/game/content/keywords";
import { CARD_RARITY_ORDER } from "../../src/game/content/rarity";

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
});
