import type {
  GameMap,
  MapRegion,
  MapRegionId,
  MapTile,
  TileType,
} from "./types";

export const MAP_COLUMNS = 36;
export const MAP_REGION_SIZE = 36;

export interface TileCountRange {
  min: number;
  max: number;
}

export type RandomTileType = Exclude<TileType, "start" | "boss">;

/**
 * 每个区域独立满足这组上下限，避免某一类格子全部挤在同一段路上。
 * 起点和 Boss 占用的格子不计入这些数量。
 */
export const MAP_TILE_LIMITS: Record<RandomTileType, TileCountRange> = {
  battle: { min: 10, max: 13 },
  event: { min: 8, max: 11 },
  treasure: { min: 6, max: 8 },
  spring: { min: 4, max: 6 },
};

export const MAP_REGIONS: MapRegion[] = [
  { id: "foothill", name: "山脚荒径", startIndex: 0, endIndex: 35 },
  { id: "mountainside", name: "云雾山腰", startIndex: 36, endIndex: 71 },
  { id: "summit", name: "雷鸣峰顶", startIndex: 72, endIndex: 107 },
];

const RANDOM_TYPES = Object.keys(MAP_TILE_LIMITS) as RandomTileType[];

const LABELS: Record<MapRegionId, Record<RandomTileType, string[]>> = {
  foothill: {
    battle: ["林间伏击", "岩坡兽影", "荒径阻敌", "旧道守卫"],
    event: ["岔路奇遇", "风蚀石门", "旅人营火", "迷雾路标"],
    treasure: ["旧木宝箱", "遗落行囊", "石缝秘藏", "猎人补给"],
    spring: ["微光泉水", "林间清泉", "苔石水潭", "山脚驿泉"],
  },
  mountainside: {
    battle: ["峭壁伏击", "古道守卫", "云中兽影", "断桥强敌"],
    event: ["悬崖栈道", "回声洞窟", "失落祭坛", "云海幻景"],
    treasure: ["旅者遗物", "封印宝匣", "古道秘藏", "商队遗物"],
    spring: ["半山泉眼", "雾隐清潭", "石壁灵泉", "云杉水涧"],
  },
  summit: {
    battle: ["雷脊伏击", "峰顶守卫", "龙巢爪牙", "风暴强敌"],
    event: ["雷鸣山口", "断裂天梯", "先民石碑", "风暴之眼"],
    treasure: ["古代秘藏", "登顶补给", "龙裔宝匣", "云巅遗物"],
    spring: ["云上清泉", "雷霆圣泉", "峰顶雪池", "龙眠水潭"],
  },
};

const ENEMY_POOLS: Record<MapRegionId, string[]> = {
  foothill: ["slime", "slime", "wolf"],
  mountainside: ["wolf", "wolf", "golem"],
  summit: ["wolf", "golem", "golem"],
};

function normalizeSeed(seed: number) {
  const value = seed >>> 0;
  return value === 0 ? 0x9e3779b9 : value;
}

function makeRandom(seed: number) {
  let value = normalizeSeed(seed);
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value = normalizeSeed(value);
    return value / 0x100000000;
  };
}

function randomIndex(random: () => number, length: number) {
  return Math.floor(random() * length);
}

function shuffle<T>(items: T[], random: () => number) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

/** 在满足所有 min/max 的前提下，把区域剩余容量随机分配给各类型。 */
function chooseCounts(capacity: number, random: () => number) {
  const counts = Object.fromEntries(
    RANDOM_TYPES.map((type) => [type, MAP_TILE_LIMITS[type].min]),
  ) as Record<RandomTileType, number>;
  let remaining = capacity - RANDOM_TYPES.reduce((sum, type) => sum + counts[type], 0);

  while (remaining > 0) {
    const available = RANDOM_TYPES.filter(
      (type) => counts[type] < MAP_TILE_LIMITS[type].max,
    );
    if (available.length === 0) {
      throw new Error(`地图格数量规则无法填满 ${capacity} 个位置`);
    }
    counts[available[randomIndex(random, available.length)]] += 1;
    remaining -= 1;
  }
  return counts;
}

function hasThreeBattlesInARow(types: TileType[]) {
  return types.some(
    (type, index) => type === "battle" && types[index - 1] === "battle" && types[index - 2] === "battle",
  );
}

function makeTypePool(capacity: number, random: () => number, preceding: TileType[]) {
  const counts = chooseCounts(capacity, random);
  const pool = RANDOM_TYPES.flatMap((type) => Array<TileType>(counts[type]).fill(type));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    shuffle(pool, random);
    if (!hasThreeBattlesInARow([...preceding, ...pool])) return pool;
  }
  // 稳定兜底：逐个挑选不会形成三连战斗的类型，保证生成不会卡死。
  const remaining = [...pool];
  const arranged: TileType[] = [];
  while (remaining.length > 0) {
    const context = [...preceding, ...arranged];
    const lastTwoAreBattles = context.at(-1) === "battle" && context.at(-2) === "battle";
    const candidates = remaining
      .map((type, index) => ({ type, index }))
      .filter(({ type }) => !lastTwoAreBattles || type !== "battle");
    const chosen = candidates[randomIndex(random, candidates.length)];
    arranged.push(chosen.type);
    remaining.splice(chosen.index, 1);
  }
  return arranged;
}

function makeRandomTile(
  id: number,
  region: MapRegionId,
  type: RandomTileType,
  random: () => number,
): MapTile {
  const labels = LABELS[region][type];
  const tile: MapTile = {
    id,
    region,
    type,
    label: labels[randomIndex(random, labels.length)],
  };
  if (type === "battle") {
    const pool = ENEMY_POOLS[region];
    tile.enemyId = pool[randomIndex(random, pool.length)];
  }
  return tile;
}

export function generateMap(seed: number): GameMap {
  const normalized = normalizeSeed(seed);
  const random = makeRandom(normalized ^ 0xa511e9b3);
  const tiles: MapTile[] = [];

  for (const region of MAP_REGIONS) {
    const hasStart = region.startIndex === 0;
    const hasBoss = region.endIndex === MAP_REGIONS.at(-1)!.endIndex;
    const capacity = MAP_REGION_SIZE - Number(hasStart) - Number(hasBoss);
    const preceding = tiles.slice(-2).map((tile) => tile.type);
    const types = makeTypePool(capacity, random, preceding);
    let poolIndex = 0;

    for (let id = region.startIndex; id <= region.endIndex; id += 1) {
      if (id === 0) {
        tiles.push({ id, region: region.id, type: "start", label: "山脚营地", safeZone: true });
      } else if (hasBoss && id === region.endIndex) {
        tiles.push({
          id,
          region: region.id,
          type: "boss",
          label: "峰顶巨龙",
          enemyId: "dragon",
          safeZone: true,
        });
      } else {
        const type = types[poolIndex] as RandomTileType;
        poolIndex += 1;
        tiles.push(makeRandomTile(id, region.id, type, random));
      }
    }
  }

  return {
    seed: normalized,
    columns: MAP_COLUMNS,
    regions: MAP_REGIONS.map((region) => ({ ...region })),
    tiles,
  };
}

/** 最近一个已走过的泉水或起点，是 PvE 战败后的休整点。 */
export function findPreviousRestTile(map: GameMap, position: number) {
  return [...map.tiles]
    .reverse()
    .find((tile) => tile.id < position && (tile.type === "start" || tile.type === "spring"))?.id ?? 0;
}
