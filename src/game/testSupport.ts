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

/**
 * 自动跑一步：任何阶段都给出一个合法动作，直到 gameOver。
 *
 * 收在这里而不是各测试自己写一份，是因为它必须**穷尽** GamePhase。以前三处
 * 各有一份副本，动画队列那份还是漏了几个分支的残缺版，遇到没覆盖的阶段就
 * 悄悄提前退出——测试照样绿，只是实际只跑了几步。写成 switch 之后，新增一种
 * 阶段会让类型检查在这里报错，而不是让某个整局跑测试悄悄缩水。
 *
 * 这个自动玩家的策略刻意保持最笨：相遇一律打招呼、解锁就挑战首领、加点一律选
 * 攻击、进商店空手离开、从不用疗牌。策略一变随机流就变，所有整局跑测试的轨迹
 * 都会跟着变，所以改它之前先想清楚是不是真的需要。
 */
export function advanceAutomatically(state: GameState): GameState {
  switch (state.phase.kind) {
    case "awaitingRoll":
      return gameReducer(state, { type: "rollMovement" });
    case "turnComplete":
      return gameReducer(state, { type: "endTurn" });
    case "encounterChoice":
      return gameReducer(state, {
        type: "chooseEncounterOpponent",
        opponentId: state.phase.choice.opponentIds[0],
      });
    case "scrollTargetChoice":
      return gameReducer(state, {
        type: "chooseScrollTarget",
        targetId: state.phase.choice.candidateIds[0],
      });
    case "encounterDecision":
      return gameReducer(state, {
        type: "chooseEncounterIntent",
        side: state.phase.encounter.choiceA.status === "pending" ? "a" : "b",
        intent: "greet",
      });
    case "tradeOffer":
      throw new Error("自动流程选择打招呼，不应进入交易报价");
    case "tradeConfirmation":
      throw new Error("自动流程选择打招呼，不应进入交易确认");
    case "bossGateChoice":
      return gameReducer(state, { type: "chooseBossChallenge", challenge: true });
    case "blessingChoice":
      return gameReducer(state, { type: "chooseBlessing", replace: false });
    case "battle": {
      const battle = state.phase.battle;
      const attackerId = battle.attacker === "a" ? battle.aPlayerId : battle.bPlayerId;
      const defenderId = battle.attacker === "a" ? battle.bPlayerId : battle.aPlayerId;
      return resolveRound(state, {
        attack: attackerId
          ? state.players[attackerId].scrolls.find((item) => item.kind === "might")?.instanceId
          : undefined,
        defense: defenderId
          ? state.players[defenderId].scrolls.find((item) => item.kind === "guard")?.instanceId
          : undefined,
      });
    }
    case "pvpPenalty": {
      const loser = state.players[state.phase.penalty.loserId];
      const scroll = loser.scrolls[0];
      if (scroll) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "scroll",
          instanceId: scroll.instanceId,
        });
      }
      const equipment = loser.equipment[0];
      if (equipment) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "equipment",
          instanceId: equipment.instanceId,
        });
      }
      throw new Error("无可支付代价的相遇战不应停留在 pvpPenalty 阶段");
    }
    case "equipmentChoice":
      return gameReducer(state, { type: "chooseEquipment" });
    case "pveReward":
      return gameReducer(state, { type: "acknowledgePveReward" });
    // 一律点攻击，好让整局的生命上限不变量只跟护符有关
    case "statGrowthChoice":
      return gameReducer(state, { type: "chooseStatGrowth", option: "attack" });
    case "shop":
      return gameReducer(state, { type: "leaveShop" });
    case "casino":
      return gameReducer(state, { type: "leaveCasino" });
    case "gameOver":
      return state;
  }
}
