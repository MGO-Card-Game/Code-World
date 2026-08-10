import { describe, expect, it } from "vitest";
import { ELITE_AFFIXES, ENEMIES, enemyTier } from "../content/enemies";
import {
  findPreviousRestTile,
  findRestTileAtOrBefore,
  generateMap,
  MAP_COLUMNS,
  MAP_EXPANSION_BATTLE_TILES,
  MAP_REGION_SIZE,
  ROAMING_AFFIX_CHANCE,
  MAP_TILE_LIMITS,
} from "../map";
import type { RandomTileType } from "../map";
import { isCombatTile } from "../types";

const RANDOM_TYPES = Object.keys(MAP_TILE_LIMITS) as RandomTileType[];

describe("受约束随机地图", () => {
  it("锁定退路时包含移动起点上的泉水，但普通查询只找身后的泉水", () => {
    const map = generateMap(4242);
    map.tiles[5].type = "spring";

    expect(findRestTileAtOrBefore(map, 5)).toBe(5);
    expect(findPreviousRestTile(map, 5)).toBeLessThan(5);
  });

  it("同一种子生成完全相同的三地区地图", () => {
    expect(generateMap(20260805)).toEqual(generateMap(20260805));
    expect(generateMap(20260805)).not.toEqual(generateMap(20260806));
  });

  it("每个区域固定 32 格，守关门与营地占据环路开头", () => {
    const map = generateMap(4242);

    expect(map.columns).toBe(MAP_COLUMNS);
    expect(MAP_COLUMNS).toBe(12);
    expect(MAP_REGION_SIZE).toBe(32);
    expect(map.regions).toHaveLength(3);
    expect(map.tiles).toHaveLength(MAP_REGION_SIZE * 3);
    for (const region of map.regions) {
      expect(region.endIndex - region.startIndex + 1).toBe(MAP_REGION_SIZE);
      expect(map.tiles[region.gateIndex]).toMatchObject({ type: "gate", safeZone: true });
      expect(map.tiles[region.entryIndex]).toMatchObject({ type: "start", safeZone: true });
      expect(map.tiles.slice(region.startIndex, region.endIndex + 1))
        .not.toContainEqual(expect.objectContaining({ type: "boss" }));
    }
  });

  it("每一区域都满足各类格子的最小值和最大值", () => {
    expect(MAP_TILE_LIMITS.spring).toEqual({ min: 2, max: 2 });
    expect(MAP_TILE_LIMITS.treasure).toEqual({ min: 3, max: 4 });
    expect(MAP_TILE_LIMITS.shop).toEqual({ min: 2, max: 2 });
    expect(MAP_TILE_LIMITS.event).toEqual({ min: 7, max: 9 });
    for (const seed of [1, 7, 42, 4242, 20260805]) {
      const map = generateMap(seed);
      for (const region of map.regions) {
        const tiles = map.tiles.slice(region.startIndex, region.endIndex + 1);
        for (const type of RANDOM_TYPES) {
          const count = tiles.filter((tile) => tile.type === type).length;
          const expansion = type === "battle" ? MAP_EXPANSION_BATTLE_TILES : 0;
          expect(count).toBeGreaterThanOrEqual(MAP_TILE_LIMITS[type].min + expansion);
          expect(count).toBeLessThanOrEqual(MAP_TILE_LIMITS[type].max + expansion);
        }
      }
    }
  });

  it("不会产生连续三个战斗类格子——精英格也算", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const types = generateMap(seed).tiles.map((tile) => tile.type);
      expect(types.some(
        (type, index) =>
          index >= 2
          && isCombatTile(type)
          && isCombatTile(types[index - 1])
          && isCombatTile(types[index - 2]),
      )).toBe(false);
    }
  });

  it("普通格抽漫游怪并可能带词条，精英格抽独立精英怪且不带词条", () => {
    for (const seed of [1, 7, 42, 4242, 20260805]) {
      for (const tile of generateMap(seed).tiles) {
        if (!isCombatTile(tile.type)) {
          expect(tile.enemyId).toBeUndefined();
          expect(tile.eliteAffix).toBeUndefined();
          continue;
        }
        expect(Object.keys(ENEMIES)).toContain(tile.enemyId);
        if (tile.type === "elite") {
          expect(enemyTier(tile.enemyId!)).toBe("elite");
          expect(tile.eliteAffix).toBeUndefined();
        } else {
          expect(enemyTier(tile.enemyId!)).toBe("roaming");
          if (tile.eliteAffix !== undefined) {
            expect(Object.keys(ELITE_AFFIXES)).toContain(tile.eliteAffix);
          }
        }
      }
    }
  });

  it("同一种子的漫游怪词缀完全一致——词缀是地图的一部分，不是开战时现抽的", () => {
    const affixesOf = (seed: number) =>
      generateMap(seed).tiles.map((tile) => tile.eliteAffix ?? null);

    expect(affixesOf(20260805)).toEqual(affixesOf(20260805));
    expect(affixesOf(20260805)).not.toEqual(affixesOf(20260806));
  });

  it("普通战斗格按集中概率投放词条，且精英与 Boss 不携带", () => {
    expect(ROAMING_AFFIX_CHANCE).toBeGreaterThan(0);
    expect(ROAMING_AFFIX_CHANCE).toBeLessThan(1);
    const tiles = Array.from({ length: 100 }, (_, index) => generateMap(index + 1).tiles).flat();
    const battles = tiles.filter((tile) => tile.type === "battle");
    const affixed = battles.filter((tile) => tile.eliteAffix !== undefined);

    expect(affixed.length).toBeGreaterThan(0);
    expect(affixed.length).toBeLessThan(battles.length);
    expect(tiles.filter((tile) => tile.type === "elite").every(
      (tile) => tile.eliteAffix === undefined,
    )).toBe(true);
    expect(tiles.filter((tile) => tile.type === "boss").every(
      (tile) => tile.eliteAffix === undefined,
    )).toBe(true);
  });
});
