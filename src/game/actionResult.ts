import { settleTileDebt } from "./tiles";
import type { ActionResult, GameState } from "./types";

/**
 * 把规则模块交回来的 ActionResult 折算成 reducer 返回值。
 *
 * false 维持“非法动作不产生新状态”的约定；带 resolveTile 的结果则在这里
 * 兑现欠下的格子结算，让相遇、交易和奖励模块不必反向依赖动作分发器。
 */
export function settleActionResult(
  next: GameState,
  previous: GameState,
  result: ActionResult,
): GameState {
  if (result === false) return previous;
  settleTileDebt(next, result);
  return next;
}
