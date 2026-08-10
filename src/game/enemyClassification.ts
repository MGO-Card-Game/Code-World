import { enemyTier } from "./content/enemies";
import type { BattleState, EnemyKind } from "./types";

/** 精英身份来自怪物本体档位，不再由是否携带词条间接推断。 */
export function isEliteEnemy(kind: EnemyKind | undefined) {
  return kind !== undefined && enemyTier(kind) === "elite";
}

export function battleHasEliteEnemy(
  battle: Pick<BattleState, "enemyId">,
) {
  return isEliteEnemy(battle.enemyId);
}

/**
 * 卡牌文案里的“精英敌人和首领”：独立精英怪、携带词条的漫游怪，以及 Boss。
 * 阶段进度与奖励不会用这条宽判定，它们分别检查精英本体与词条。
 */
export function targetsEliteOrBoss(
  battle: Pick<BattleState, "kind" | "enemyId" | "enemyAffix">,
) {
  return battle.kind === "boss"
    || battleHasEliteEnemy(battle)
    || battle.enemyAffix !== undefined;
}
