import { gameReducer } from "./engine";
import type { BattleState, CombatSide, GameState } from "./types";

/**
 * 测试辅助。只被 *.test.ts 引用，不会进产物包。
 */

/** 构造一个战斗状态，补齐卷轴选择等样板字段 */
export function makeBattle(
  overrides: Partial<BattleState> & Pick<BattleState, "kind" | "aPlayerId">,
): BattleState {
  const bPlayerId = overrides.bPlayerId;
  return {
    hpA: 18,
    hpB: 18,
    attacker: "a",
    round: 1,
    initiativeA: 6,
    initiativeB: 1,
    log: [],
    choiceA: { status: "pending" },
    choiceB: bPlayerId ? { status: "pending" } : { status: "declined" },
    ...overrides,
  };
}

function sideIsPlayer(battle: BattleState, side: CombatSide) {
  return (side === "a" ? battle.aPlayerId : battle.bPlayerId) !== undefined;
}

/**
 * 走完一个完整攻击回合：攻防两侧各自提交卷轴选择。
 *
 * 敌人一侧在开局时就被标记为 declined，所以这里只给玩家一侧提交，
 * 提交齐了引擎会自动结算。
 */
export function resolveRound(
  state: GameState,
  choices: { attack?: string; defense?: string } = {},
): GameState {
  if (state.phase.kind !== "battle") return state;
  const battle = state.phase.battle;
  const attacker = battle.attacker;
  const defender: CombatSide = attacker === "a" ? "b" : "a";

  let next = state;
  if (sideIsPlayer(battle, attacker)) {
    next = gameReducer(next, {
      type: "submitScrollChoice",
      side: attacker,
      instanceId: choices.attack,
    });
  }
  if (sideIsPlayer(battle, defender)) {
    next = gameReducer(next, {
      type: "submitScrollChoice",
      side: defender,
      instanceId: choices.defense,
    });
  }
  return next;
}
