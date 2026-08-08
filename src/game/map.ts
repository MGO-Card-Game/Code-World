import { pickEliteAffix, pickRoamingEnemy } from "./content/enemies";
import type {
  GameMap,
  MapRegion,
  MapRegionId,
  MapTile,
  TileType,
} from "./types";
import { isCombatTile } from "./types";

/** 10×6 矩形外框恰好有 28 个格子，三个阶段各占一圈。 */
export const MAP_COLUMNS = 10;
export const MAP_REGION_SIZE = 28;

export interface TileCountRange {
  min: number;
  max: number;
}

export type RandomTileType = Exclude<TileType, "start" | "boss" | "gate">;

/**
 * 每个区域独立满足这组上下限，避免某一类格子全部挤在同一段路上。
 * 守关门和阶段营地占用的格子不计入这些数量。
 *
 * 加类型时要连带核对可行性：min 合计必须 ≤ 区域容量 ≤ max 合计，
 * 否则 chooseCounts 会抛「地图格数量规则无法填满」。
 * 现在是 min 23、max 29，每圈扣除守关门与营地后容量为 26。
 * 泉水与商店固定两个；商店增加的名额从宝箱配额中划出。
 */
export const MAP_TILE_LIMITS: Record<RandomTileType, TileCountRange> = {
  battle: { min: 6, max: 8 },
  elite: { min: 2, max: 3 },
  event: { min: 7, max: 9 },
  treasure: { min: 3, max: 4 },
  blessing: { min: 1, max: 1 },
  spring: { min: 2, max: 2 },
  shop: { min: 2, max: 2 },
};

export const MAP_REGIONS: MapRegion[] = [
  {
    id: "foothill", name: "山脚荒径", startIndex: 0, endIndex: 27,
    gateIndex: 0, entryIndex: 1, bossEnemyId: "banditChief",
    requirements: [{ type: "uniqueEliteVictories", target: 1, label: "击败 1 个精英格敌人" }],
  },
  {
    id: "mountainside", name: "云雾山腰", startIndex: 28, endIndex: 55,
    gateIndex: 28, entryIndex: 29, bossEnemyId: "frostFang",
    requirements: [{ type: "uniqueEliteVictories", target: 2, label: "击败 2 个不同精英格敌人" }],
  },
  {
    id: "summit", name: "雷鸣峰顶", startIndex: 56, endIndex: 83,
    gateIndex: 56, entryIndex: 57, bossEnemyId: "dragon",
    // 龙巢正式条件尚未确定，暂用两个不同山顶精英作为可完整通关的占位规则。
    requirements: [{ type: "uniqueEliteVictories", target: 2, label: "击败 2 个不同山顶精英" }],
  },
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
    shop: ["荒径商栈", "旧道货亭", "旅商帐篷", "林间市集"],
  },
  mountainside: {
    battle: ["峭壁伏击", "古道守卫", "云中兽影", "断桥强敌"],
    elite: ["峭壁凶兽", "云中异种", "断桥恶客", "古道悍匪"],
    event: ["悬崖栈道", "回声洞窟", "失落祭坛", "云海幻景"],
    treasure: ["旅者遗物", "封印宝匣", "古道秘藏", "商队遗物"],
    blessing: ["云中古坛", "风语石龛", "先民圣印", "雾隐祷所"],
    spring: ["半山泉眼", "雾隐清潭", "石壁灵泉", "云杉水涧"],
    shop: ["云腰商栈", "悬崖货亭", "行商营帐", "雾中市集"],
  },
  summit: {
    battle: ["雷脊伏击", "峰顶守卫", "龙巢爪牙", "风暴强敌"],
    elite: ["雷脊凶兽", "龙巢异种", "风暴悍将", "峰顶恶灵"],
    event: ["雷鸣山口", "断裂天梯", "先民石碑", "风暴之眼"],
    treasure: ["古代秘藏", "登顶补给", "龙裔宝匣", "云巅遗物"],
    blessing: ["雷霆祭坛", "星辉石龛", "峰顶圣印", "龙脉祷所"],
    spring: ["云上清泉", "雷霆圣泉", "峰顶雪池", "龙眠水潭"],
    shop: ["峰顶商栈", "天梯货亭", "登顶商队", "云巅市集"],
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
  if (type === "shop") tile.safeZone = true;
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
    const capacity = MAP_REGION_SIZE - 2;
    const types = makeTypePool(capacity, random, ["gate", "start"]);
    let poolIndex = 0;

    for (let id = region.startIndex; id <= region.endIndex; id += 1) {
      if (id === region.gateIndex) {
        tiles.push({
          id,
          region: region.id,
          type: "gate",
          label: region.id === "summit" ? "龙巢入口" : "守关之门",
          safeZone: true,
        });
      } else if (id === region.entryIndex) {
        const labels: Record<MapRegionId, string> = {
          foothill: "山脚营地",
          mountainside: "云腰营地",
          summit: "峰顶营地",
        };
        tiles.push({
          id,
          region: region.id,
          type: "start",
          label: labels[region.id],
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

export function regionForPosition(map: GameMap, position: number) {
  const tile = map.tiles[position];
  if (!tile) throw new Error(`地图位置 ${position} 不存在`);
  return map.regions.find((region) => region.id === tile.region)!;
}

export function tilesInRegion(map: GameMap, regionId: MapRegionId) {
  const region = map.regions.find((candidate) => candidate.id === regionId);
  if (!region) throw new Error(`地图区域 ${regionId} 不存在`);
  return map.tiles.slice(region.startIndex, region.endIndex + 1);
}

/** 最近一个已走过的泉水或起点，是 PvE 战败后的休整点。 */
export function findPreviousRestTile(map: GameMap, position: number) {
  const region = regionForPosition(map, position);
  for (let offset = 1; offset < MAP_REGION_SIZE; offset += 1) {
    const local = (position - region.startIndex - offset + MAP_REGION_SIZE) % MAP_REGION_SIZE;
    const tile = map.tiles[region.startIndex + local];
    if (tile.type === "start" || tile.type === "spring") return tile.id;
  }
  return region.entryIndex;
}

/** 位于指定位置或其后方的最近休整点；用于在掷骰移动前锁定战败退路。 */
export function findRestTileAtOrBefore(map: GameMap, position: number) {
  const tile = map.tiles[position];
  return tile.type === "start" || tile.type === "spring"
    ? position
    : findPreviousRestTile(map, position);
}
