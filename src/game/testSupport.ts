import { gameReducer } from "./engine";
import type { BattleState, CombatSide, GameState } from "./types";

/**
 * 测试辅助。只被 *.test.ts 引用，不会进产物包。
 */

/**
 * 「整局跑通」类测试共用的种子与步数上限。
 *
 * 这类测试对随机流极其敏感：调一次稀有度权重、加一张卡，整局轨迹就全变了，
 * 长度能从一千多步跳到一万六。所以两件事分开对待——
 *
 * 种子挑一颗跑得快的，保证套件本身别变慢；
 * 上限只是死循环的保险丝，不是性能预算。它对正常结束的对局零成本，
 * 所以留足余量，别让它退化成"这颗种子恰好够快"的暗坑
 * （5000 这个旧上限就是这样：抽样 21 颗种子里有 4 颗本来就会超）。
 */
export const PLAYTHROUGH_SEED = 3;
export const PLAYTHROUGH_CAP = 20000;

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
/** 一侧本回合要打的牌。张数不限，只打一张时可以直接写字符串。 */
export type RoundChoice = string | readonly string[] | undefined;

function toInstanceIds(choice: RoundChoice): readonly string[] {
  if (choice === undefined) return [];
  return typeof choice === "string" ? [choice] : choice;
}

export function resolveRound(
  state: GameState,
  choices: { attack?: RoundChoice; defense?: RoundChoice } = {},
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
      instanceIds: toInstanceIds(choices.attack),
    });
  }
  if (sideIsPlayer(battle, defender)) {
    next = gameReducer(next, {
      type: "submitScrollChoice",
      side: defender,
      instanceIds: toInstanceIds(choices.defense),
    });
  }
  return next;
}
