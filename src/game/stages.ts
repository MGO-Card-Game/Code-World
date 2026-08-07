import type {
  GameMap,
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
    case "uniqueEliteVictories":
      return player.stageProgress[regionId].defeatedEliteTileIds.length;
  }
}

export function stageBossUnlocked(player: PlayerStats, region: MapRegion) {
  return region.requirements.every(
    (requirement) => requirementValueForRegion(player, region.id, requirement) >= requirement.target,
  );
}

export function recordEliteVictory(player: Player, regionId: MapRegionId, tileIndex: number) {
  const cleared = player.stageProgress[regionId].defeatedEliteTileIds;
  if (cleared.includes(tileIndex)) return false;
  cleared.push(tileIndex);
  return true;
}

export function nextStage(map: GameMap, regionId: MapRegionId) {
  const index = map.regions.findIndex((region) => region.id === regionId);
  return index >= 0 ? map.regions[index + 1] : undefined;
}
