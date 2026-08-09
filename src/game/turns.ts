import { addHistory, emit, nextPlayerId } from "./state";
import type { GameState } from "./types";

/**
 * 回合交接与会话级的事件 id 水位线。
 *
 * 只依赖 state.ts，所以任何规则模块都能安全地推进回合，不必绕回 engine。
 */

export function advanceCompletedTurn(state: GameState) {
  state.activePlayerId = nextPlayerId(state);
  state.turn += 1;
  state.lastMovementRoll = undefined;
  state.movementOrigin = undefined;
  const incoming = state.players[state.activePlayerId];
  const skipped = incoming.skipNextMovement;
  if (skipped) {
    delete incoming.skipNextMovement;
    state.phase = { kind: "turnComplete" };
  } else {
    state.phase = { kind: "awaitingRoll" };
  }
  emit(state, {
    type: "turnStarted",
    playerId: state.activePlayerId,
    turn: state.turn,
  });
  addHistory(
    state,
    skipped
      ? `${incoming.name}受${skipped.reason}影响，本回合无法移动。`
      : `轮到${incoming.name}行动。`,
  );
}

/**
 * 让新开一局的事件 id 接着上一局往后排。
 *
 * 播放队列靠“id 水位线”给事件去重，而 createInitialGame 每次都从 1 开始。
 * 如果重开后的 id 与上一局重叠，新开局的事件就会被当成重复丢掉。
 * 保证整个会话内 id 单调递增，去重逻辑才始终成立。
 */
export function rebaseEventIds(state: GameState, startId: number): GameState {
  const offset = startId - 1;
  if (offset <= 0) return state;
  state.lastEvents = state.lastEvents.map((event) => ({ ...event, id: event.id + offset }));
  state.nextEventId += offset;
  return state;
}
