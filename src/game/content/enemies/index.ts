import type { MapRegionId } from "../../types";
import { pickByRarity } from "../rarity";
import { pickWeighted } from "../weighted";
import { ELITE_AFFIXES, type EliteAffixKind } from "./affixes";
import { APEX_ENEMIES } from "./apex";
import { BOSS_ENEMIES } from "./boss";
import type { EnemyDefinition, EnemyTier } from "./definition";
import { ROAMING_ENEMIES } from "./roaming";

export { ENEMY_TIER_NAMES, defineEnemies } from "./definition";
export type { EnemyAbility, EnemyBody, EnemyDefinition, EnemyTier } from "./definition";
export {
  ELITE_AFFIXES,
  ELITE_BASE_MODIFIERS,
  eliteAffixDefinition,
} from "./affixes";
export type { EliteAffixDefinition, EliteAffixKind } from "./affixes";

/** 档位表原样保留一份，便于按档位遍历（调试面板、投放分析都用得上）。 */
export const ENEMIES_BY_TIER = {
  roaming: ROAMING_ENEMIES,
  apex: APEX_ENEMIES,
  boss: BOSS_ENEMIES,
} as const satisfies Record<EnemyTier, Record<string, EnemyDefinition>>;

/**
 * 全部怪物。新增一只怪只要改对应的档位表，这里不用动。
 *
 * 档位表之间的键必须互不重复，否则展开时后者会静默覆盖前者；
 * category.test.ts 里有一条数量断言守着这件事。
 */
export const ENEMIES = {
  ...ROAMING_ENEMIES,
  ...APEX_ENEMIES,
  ...BOSS_ENEMIES,
};

/** 直接由配置键推导；新增怪物时无需再维护另一份字符串联合类型。 */
export type EnemyKind = keyof typeof ENEMIES;

export function enemyDefinition(kind: EnemyKind): EnemyDefinition {
  return ENEMIES[kind];
}

export function enemyTier(kind: EnemyKind): EnemyTier {
  return ENEMIES[kind].tier;
}

/** 某个档位在某个区域的投放池，权重为 0 或未声明的怪不参加。 */
function regionPool(tier: EnemyTier, region: MapRegionId) {
  const table = ENEMIES_BY_TIER[tier] as Record<string, EnemyDefinition>;
  return (Object.keys(table) as EnemyKind[])
    .map((kind) => [kind, table[kind].regions?.[region] ?? 0] as const)
    .filter(([, weight]) => weight > 0);
}

function pickFromRegion(
  tier: EnemyTier,
  region: MapRegionId,
  random: () => number,
): EnemyKind {
  const pool = regionPool(tier, region);
  if (pool.length === 0) {
    throw new Error(`区域 ${region} 没有可投放的${tier}怪物`);
  }
  return pickWeighted(pool, random);
}

/** 战斗格与精英格用的漫游怪。 */
export function pickRoamingEnemy(region: MapRegionId, random: () => number) {
  return pickFromRegion("roaming", region, random);
}

/** 强敌格用的强敌。不进随机池，所以和漫游怪分开抽。 */
export function pickApexEnemy(region: MapRegionId, random: () => number) {
  return pickFromRegion("apex", region, random);
}

/** 该区域能不能放对应档位的怪，供地图生成与结构测试判断。 */
export function hasRegionPool(tier: EnemyTier, region: MapRegionId) {
  return regionPool(tier, region).length > 0;
}

/** 先按稀有度抽档，再在同稀有度的词缀中等概率抽取，与卷轴同一条通路。 */
export function pickEliteAffix(random: () => number): EliteAffixKind {
  const kinds = Object.keys(ELITE_AFFIXES) as EliteAffixKind[];
  return pickByRarity(kinds, (kind) => ELITE_AFFIXES[kind].rarity, random);
}
