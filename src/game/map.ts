import { pickEliteAffix, pickRoamingEnemy } from "./content/enemies";
import type {
  GameMap,
  MapRegion,
  MapRegionId,
  MapTile,
  TileType,
} from "./types";
import { isCombatTile } from "./types";

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
 *
 * 加类型时要连带核对可行性：min 合计必须 ≤ 区域容量 ≤ max 合计，
 * 否则 chooseCounts 会抛「地图格数量规则无法填满」。
 * 现在是 min 29、max 40，容量 35～36。
 */
export const MAP_TILE_LIMITS: Record<RandomTileType, TileCountRange> = {
  battle: { min: 8, max: 11 },
  elite: { min: 2, max: 3 },
  event: { min: 8, max: 11 },
  treasure: { min: 6, max: 8 },
  blessing: { min: 1, max: 1 },
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
    elite: ["荒径凶兽", "岩坡异种", "林深咆哮", "旧道恶徒"],
    event: ["岔路奇遇", "风蚀石门", "旅人营火", "迷雾路标"],
    treasure: ["旧木宝箱", "遗落行囊", "石缝秘藏", "猎人补给"],
    blessing: ["古树赐福", "晨曦祭坛", "山灵石龛", "荒径圣印"],
    spring: ["微光泉水", "林间清泉", "苔石水潭", "山脚驿泉"],
  },
  mountainside: {
    battle: ["峭壁伏击", "古道守卫", "云中兽影", "断桥强敌"],
    elite: ["峭壁凶兽", "云中异种", "断桥恶客", "古道悍匪"],
    event: ["悬崖栈道", "回声洞窟", "失落祭坛", "云海幻景"],
    treasure: ["旅者遗物", "封印宝匣", "古道秘藏", "商队遗物"],
    blessing: ["云中古坛", "风语石龛", "先民圣印", "雾隐祷所"],
    spring: ["半山泉眼", "雾隐清潭", "石壁灵泉", "云杉水涧"],
  },
  summit: {
    battle: ["雷脊伏击", "峰顶守卫", "龙巢爪牙", "风暴强敌"],
    elite: ["雷脊凶兽", "龙巢异种", "风暴悍将", "峰顶恶灵"],
    event: ["雷鸣山口", "断裂天梯", "先民石碑", "风暴之眼"],
    treasure: ["古代秘藏", "登顶补给", "龙裔宝匣", "云巅遗物"],
    blessing: ["雷霆祭坛", "星辉石龛", "峰顶圣印", "龙脉祷所"],
    spring: ["云上清泉", "雷霆圣泉", "峰顶雪池", "龙眠水潭"],
  },
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

/**
 * 按「战斗类」判定，精英格也算。
 * 连打三场，对手是不是精英对手感没有区别。
 */
function hasThreeBattlesInARow(types: TileType[]) {
  return types.some(
    (type, index) =>
      isCombatTile(type)
      && index >= 2
      && isCombatTile(types[index - 1])
      && isCombatTile(types[index - 2]),
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
    const lastTwoAreBattles = context.length >= 2
      && isCombatTile(context.at(-1)!)
      && isCombatTile(context.at(-2)!);
    const candidates = remaining
      .map((type, index) => ({ type, index }))
      .filter(({ type }) => !lastTwoAreBattles || !isCombatTile(type));
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
  if (isCombatTile(type)) {
    tile.enemyId = pickRoamingEnemy(region, random);
  }
  /*
    词缀在地图生成时就定死并随 GameState 广播，而不是等进战斗时再抽。
    交给战斗现抽的话，同种子重放和联机双端都会对不上——地图只生成一次，
    战斗却在各自的随机流里发生。
  */
  if (type === "elite") {
    tile.eliteAffix = pickEliteAffix(random);
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

/** 位于指定位置或其后方的最近休整点；用于在掷骰移动前锁定战败退路。 */
export function findRestTileAtOrBefore(map: GameMap, position: number) {
  return [...map.tiles]
    .reverse()
    .find((tile) => tile.id <= position && (tile.type === "start" || tile.type === "spring"))?.id ?? 0;
}
