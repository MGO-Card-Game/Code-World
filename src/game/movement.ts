import { MAP_REGION_SIZE, regionForPosition } from "./map";
import { restAtStageCamp, stageBossUnlocked } from "./stages";
import type { GameState, MapRegion, MapTile, Player } from "./types";

/**
 * 沿环路挪动棋子这件事本身，不含"落点会发生什么"。
 *
 * 单独成模块的理由是依赖方向：掷骰移动在 engine，事件驱动的移动（翻跟头、
 * 移形换影）在 mapEvents，而 mapEvents 是 tiles 的下游、tiles 又是 engine 的
 * 下游——三处共用一份走位逻辑，只能放在都够得着、且谁也不依赖的这一层。
 *
 * 所以这里只碰位置、圈数和营地回血，一概不碰 phase，也不结算落点格子：
 * 那是 tiles 的活，由调用方自己去接。
 */

export interface LoopAdvanceResult {
  region: MapRegion;
  interceptedAtGate: boolean;
  passedCamp: boolean;
  targetTile: MapTile;
}

/**
 * 沿区域环路逐格前进 roll 格：处理守关门计次拦截、营地回血判定与经过效果。
 * 掷骰移动和"灵活行动"这类卷轴共用同一条路径，保证两者手感完全一致。
 */
export function advanceAlongLoop(
  state: GameState,
  player: Player,
  roll: number,
): LoopAdvanceResult {
  const region = regionForPosition(state.map, player.position);
  player.previousStopPosition = player.position;
  let interceptedAtGate = false;
  let passedCamp = false;
  for (let step = 0; step < roll; step += 1) {
    const local = player.position - region.startIndex;
    const nextLocal = (local + 1) % MAP_REGION_SIZE;
    player.position = region.startIndex + nextLocal;
    if (player.position === region.entryIndex) passedCamp = true;
    if (player.position !== region.gateIndex) continue;
    player.stageProgress[region.id].laps += 1;
    if (stageBossUnlocked(player, region)) {
      interceptedAtGate = true;
      break;
    }
  }
  return { region, interceptedAtGate, passedCamp, targetTile: state.map.tiles[player.position] };
}

/**
 * 直接把玩家挪到 region 内的绝对格子 targetPosition，不经过任何中间格。
 * teleport 系效果（固定距离/任意门）共用：只结算落点本身，含落点正好是
 * 营地或守关门的情况；沿途什么都不触发。
 */
export function landDirectlyAt(
  state: GameState,
  player: Player,
  region: MapRegion,
  targetPosition: number,
): { interceptedAtGate: boolean; targetTile: MapTile } {
  player.previousStopPosition = player.position;
  player.position = targetPosition;
  let interceptedAtGate = false;
  if (player.position === region.gateIndex) {
    player.stageProgress[region.id].laps += 1;
    interceptedAtGate = stageBossUnlocked(player, region);
  }
  if (player.position === region.entryIndex) restAtStageCamp(state, player, region);
  return { interceptedAtGate, targetTile: state.map.tiles[player.position] };
}
