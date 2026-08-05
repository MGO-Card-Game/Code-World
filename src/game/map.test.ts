import { describe, expect, it } from "vitest";
import { generateMap, MAP_REGION_SIZE, MAP_TILE_LIMITS } from "./map";
import type { RandomTileType } from "./map";

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

  it("不会产生连续三个战斗格", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const types = generateMap(seed).tiles.map((tile) => tile.type);
      expect(types.some(
        (type, index) => type === "battle" && types[index - 1] === "battle" && types[index - 2] === "battle",
      )).toBe(false);
    }
  });
});
