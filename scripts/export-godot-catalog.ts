import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BLESSINGS, type BlessingDefinition } from "../src/game/content/blessings";
import {
  ELITE_AFFIXES, ENEMIES, ENEMY_TIER_NAMES, type EliteAffixDefinition, type EnemyDefinition, type EnemyKind,
} from "../src/game/content/enemies";
import {
  EQUIPMENT, EQUIPMENT_CATEGORY_NAMES, EQUIPMENT_SLOT_LIMITS, equipmentKeywords,
} from "../src/game/content/equipment";
import { MAP_EVENTS } from "../src/game/content/events";
import { KEYWORDS, orderKeywords } from "../src/game/content/keywords";
import { CARD_RARITY_ORDER } from "../src/game/content/rarity";
import { RULE_TERMS } from "../src/game/content/ruleTerms";
import {
  SCROLL_CATEGORY_NAMES, SCROLL_CATEGORY_SIGILS, SCROLLS_BY_GROUP,
  scrollCategory, scrollKeywords, type ScrollDefinition,
} from "../src/game/content/scrolls";
import { ECONOMY } from "../src/game/economy";
import { STAT_GROWTH } from "../src/game/growth";
import { enemyDiceCountBonus, enemyDieSidesBonus } from "../src/game/selectors";

function project<K extends string, T, U>(table: Record<K, T>, fields: (entry: T, key: K) => U): Record<string, U> {
  return Object.fromEntries((Object.keys(table) as K[]).map((key) => [key, fields(table[key], key)]));
}

// Copy every dictionary in code-unit order, including records nested inside arrays.
// Array order belongs to the content (keyword priority, ability order, aliases, etc.).
function sortedCopy<T>(value: T): T;
function sortedCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedCopy);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortedCopy(record[key])]));
}

function scrollEntry(def: ScrollDefinition, group: string) {
  const category = scrollCategory(def);
  const keywords = scrollKeywords(def);
  const movement = def.effects.find((e) =>
    e.type === "chooseMovement" || e.type === "teleport" || e.type === "teleportAnywhere");
  return {
    name: def.name, description: def.description, rarity: def.rarity,
    category, categoryName: SCROLL_CATEGORY_NAMES[category], categorySigil: SCROLL_CATEGORY_SIGILS[category],
    timings: def.timings, group, keywords, drawable: def.drawable !== false,
    needsTarget: keywords.includes("needsTarget"),
    mapConfig: movement?.type ?? "none",
    teleportMaxDistance: movement?.type === "teleport" ? movement.maxDistance : null,
    healsHp: def.effects.some((e) => e.type === "heal" && e.amount > 0),
    forfeitsMovement: def.effects.some((e) => e.type === "forfeitMovement"),
    replacesMovement: keywords.includes("replacesMovement"),
    retracesPosition: def.effects.some((e) => e.type === "returnToPreviousPosition"),
  };
}

export function buildGodotContentCatalog() {
  const scrolls = Object.fromEntries(Object.entries(SCROLLS_BY_GROUP).flatMap(([group, table]) =>
    Object.entries(table).map(([kind, def]) => [kind, scrollEntry(def, group)] as const),
  ));
  return sortedCopy({
    schemaVersion: 1,
    statGrowth: STAT_GROWTH,
    campShop: {
      scrollPrice: ECONOMY.shop.scroll.price,
      healingPrice: ECONOMY.shop.healing.price,
      healingAmount: ECONOMY.shop.healing.amount,
    },
    rarities: CARD_RARITY_ORDER,
    keywordOrder: Object.keys(KEYWORDS),
    keywords: project(KEYWORDS, ({ label, rule }) => ({ label, rule })),
    ruleTerms: project(RULE_TERMS, ({ label, aliases, rule, group }) => ({ label, aliases, rule, group })),
    scrollCategories: { names: SCROLL_CATEGORY_NAMES, sigils: SCROLL_CATEGORY_SIGILS },
    equipmentCategories: { names: EQUIPMENT_CATEGORY_NAMES, slotLimits: EQUIPMENT_SLOT_LIMITS },
    enemyTiers: ENEMY_TIER_NAMES,
    scrolls,
    enemies: project(ENEMIES, (def: EnemyDefinition, kind: EnemyKind) => ({
      name: def.name, tier: def.tier, tierName: ENEMY_TIER_NAMES[def.tier],
      maxHp: def.maxHp, attack: def.attack, defense: def.defense,
      attackDice: 1 + enemyDiceCountBonus(kind, undefined, "attack"),
      attackSides: 6 + enemyDieSidesBonus(kind, undefined, "attack"),
      defenseDice: 1 + enemyDiceCountBonus(kind, undefined, "defense"),
      defenseSides: 6 + enemyDieSidesBonus(kind, undefined, "defense"),
      abilities: (def.abilities ?? []).map(({ name, description, keywords }) => ({
        name, description, keywords: orderKeywords(keywords ?? []),
      })),
    })),
    eliteAffixes: project(ELITE_AFFIXES, (def: EliteAffixDefinition) => ({
      name: def.name, description: def.description, rarity: def.rarity, keywords: orderKeywords(def.keywords ?? []),
    })),
    equipment: project(EQUIPMENT, (def) => ({
      name: def.name, description: def.description, rarity: def.rarity, category: def.category,
      categoryName: EQUIPMENT_CATEGORY_NAMES[def.category], keywords: equipmentKeywords(def),
    })),
    blessings: project(BLESSINGS, (def: BlessingDefinition) => ({
      name: def.name, description: def.description, enabled: def.enabled !== false,
    })),
    mapEvents: project(MAP_EVENTS, ({ name, description, category }) => ({ name, description, category })),
  });
}

export function serializeGodotContentCatalog(): string {
  return JSON.stringify(buildGodotContentCatalog(), null, 2) + "\n";
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = new URL("../godot/data/", import.meta.url);
  const file = new URL("content_catalog.json", directory);
  const bytes = Buffer.from(serializeGodotContentCatalog(), "utf8");
  if (!existsSync(file) || !readFileSync(file).equals(bytes)) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, bytes);
  }
}
