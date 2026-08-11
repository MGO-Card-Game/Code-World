import { regionForPosition } from "./map";
import { addHistory, emit } from "./state";
import type {
  GameMap,
  GameState,
  MapRegion,
  MapRegionId,
  Player,
  PlayerStats,
  StageRequirement,
} from "./types";

/** 阶段目标只读玩家永久进度，不依赖当前背包，避免 PvP 转移让资格反复锁上。 */
export function requirementValueForRegion(
  player: PlayerStats,
  regionId: MapRegionId,
  requirement: StageRequirement,
) {
  switch (requirement.type) {
    case "laps":
      return player.stageProgress[regionId].laps;
    case "eliteVictories":
      return player.stageProgress[regionId].eliteVictories;
  }
}

export function stageBossUnlocked(player: PlayerStats, region: MapRegion) {
  return region.requirements.every(
    (requirement) => requirementValueForRegion(player, region.id, requirement) >= requirement.target,
  );
}

export function recordEliteVictory(player: Player, regionId: MapRegionId) {
  player.stageProgress[regionId].eliteVictories += 1;
}

/**
 * 站在守关门上时能否主动打开首领入口。
 *
 * 不这样开一道口子的话，条件已满足却停在门上的玩家（拒绝过一次挑战、或者靠不屈意志
 * 原地复活）必须再绕满一圈才能重新跨过守关门，等于白等一整轮。
 */
export function canOpenBossGate(
  state: Pick<GameState, "phase" | "activePlayerId" | "map">,
  player: PlayerStats,
) {
  if (state.phase.kind !== "awaitingRoll") return false;
  if (state.activePlayerId !== player.id) return false;
  const region = regionForPosition(state.map, player.position);
  return player.position === region.gateIndex && stageBossUnlocked(player, region);
}

/**
 * 阶段营地把生命回满，返回回复量。
 *
 * 「经过」就算数，不必停在营地上：路过营地再踩进战斗格的人是满血开打的，
 * 否则同一条路上停一格与不停一格的差别会大到玩家只敢卡着营地走。
 *
 * 击败阶段首领后被送到下一阶段营地也走这里——那一步同样是「到了营地」，
 * 不必在首领奖励里另写一份回血。
 */
export function restAtStageCamp(state: GameState, player: Player, region: MapRegion) {
  if (player.hp >= player.maxHp) return 0;
  const from = player.hp;
  player.hp = player.maxHp;
  emit(state, {
    type: "playerHpChanged",
    playerId: player.id,
    from,
    to: player.hp,
    maxHp: player.maxHp,
    reason: "camp",
  });
  addHistory(
    state,
    `${player.name}在「${state.map.tiles[region.entryIndex].label}」休整，生命回满。`,
  );
  return player.hp - from;
}

export function nextStage(map: GameMap, regionId: MapRegionId) {
  const index = map.regions.findIndex((region) => region.id === regionId);
  return index >= 0 ? map.regions[index + 1] : undefined;
}
