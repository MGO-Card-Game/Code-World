import { describe, expect, it } from "vitest";
import { ELITE_AFFIXES, ENEMIES } from "./content/enemies";
import { generateMap, MAP_REGION_SIZE, MAP_TILE_LIMITS } from "./map";
import type { RandomTileType } from "./map";
import { isCombatTile } from "./types";

const RANDOM_TYPES = Object.keys(MAP_TILE_LIMITS) as RandomTileType[];

describe("受约束随机地图", () => {
  it("同一种子生成完全相同的三地区地图", () => {
    expect(generateMap(20260805)).toEqual(generateMap(20260805));
    expect(generateMap(20260805)).not.toEqual(generateMap(20260806));
  });

  it("每个区域固定 36 格，起点和 Boss 位于两端", () => {
    const map = generateMap(4242);

    expect(map.regions).toHaveLength(3);
    expect(map.tiles).toHaveLength(MAP_REGION_SIZE * 3);
    expect(map.tiles[0]).toMatchObject({ id: 0, type: "start", safeZone: true });
    expect(map.tiles.at(-1)).toMatchObject({ id: 107, type: "boss", safeZone: true });
    for (const region of map.regions) {
      expect(region.endIndex - region.startIndex + 1).toBe(MAP_REGION_SIZE);
    }
  });

  it("每一区域都满足各类格子的最小值和最大值", () => {
    for (const seed of [1, 7, 42, 4242, 20260805]) {
      const map = generateMap(seed);
      for (const region of map.regions) {
        const tiles = map.tiles.slice(region.startIndex, region.endIndex + 1);
        for (const type of RANDOM_TYPES) {
          const count = tiles.filter((tile) => tile.type === type).length;
          expect(count).toBeGreaterThanOrEqual(MAP_TILE_LIMITS[type].min);
          expect(count).toBeLessThanOrEqual(MAP_TILE_LIMITS[type].max);
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

  it("战斗类格子都绑定了怪物，精英格还带词缀", () => {
    for (const seed of [1, 7, 42, 4242, 20260805]) {
      for (const tile of generateMap(seed).tiles) {
        // Boss 格也绑定了怪物，只是它不算"战斗类"——那个判定管的是三连约束
        if (!isCombatTile(tile.type) && tile.type !== "boss") {
          expect(tile.enemyId).toBeUndefined();
          expect(tile.eliteAffix).toBeUndefined();
          continue;
        }
        expect(Object.keys(ENEMIES)).toContain(tile.enemyId);
        if (tile.type === "elite") {
          expect(Object.keys(ELITE_AFFIXES)).toContain(tile.eliteAffix);
        } else {
          // 词缀只贴在精英格上，普通战斗格和 Boss 格都不该有
          expect(tile.eliteAffix).toBeUndefined();
        }
      }
    }
  });

  it("同一种子的精英词缀完全一致——词缀是地图的一部分，不是开战时现抽的", () => {
    const affixesOf = (seed: number) =>
      generateMap(seed).tiles.map((tile) => tile.eliteAffix ?? null);

    expect(affixesOf(20260805)).toEqual(affixesOf(20260805));
    expect(affixesOf(20260805)).not.toEqual(affixesOf(20260806));
  });
});
