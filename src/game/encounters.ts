import { startBattle } from "./battle";
import { addHistory } from "./state";
import type {
  ActionResult,
  GameAction,
  GameState,
  Player,
} from "./types";

/**
 * 同格相遇：选对手、三选一的意向、以及意向汇合后的分流。
 *
 * 相遇有三个出口——打起来交给 battle，谈交易交给 trading，友好招呼则回到那一格
 * 继续结算。最后一条以 ActionResult 交回 engine，见 ActionResult 的说明。
 */

export function startEncounterDecision(
  state: GameState,
  aPlayerId: Player["id"],
  bPlayerId: Player["id"],
  tileIndex: number,
) {
  state.phase = {
    kind: "encounterDecision",
    encounter: {
      aPlayerId,
      bPlayerId,
      tileIndex,
      choiceA: { status: "pending" },
      choiceB: { status: "pending" },
    },
  };
  addHistory(
    state,
    `${state.players[aPlayerId].name}遇见${state.players[bPlayerId].name}，双方决定战斗、交易或友好招呼。`,
  );
}

/** 选择同格相遇目标；候选名单由移动结算时锁定，不能由客户端自行指定。 */
export function chooseEncounterOpponent(state: GameState, opponentId: Player["id"]) {
  if (state.phase.kind !== "encounterChoice") return false;
  const { challengerId, opponentIds, tileIndex } = state.phase.choice;
  if (!opponentIds.includes(opponentId) || opponentId === challengerId) return false;

  const challenger = state.players[challengerId];
  const opponent = state.players[opponentId];
  if (
    !challenger ||
    !opponent ||
    state.unavailablePlayerIds.includes(opponentId) ||
    challenger.position !== tileIndex ||
    opponent.position !== tileIndex ||
    state.map.tiles[tileIndex]?.safeZone
  ) {
    return false;
  }

  startEncounterDecision(state, challengerId, opponentId, tileIndex);
  return true;
}

export function chooseEncounterIntent(
  state: GameState,
  action: Extract<GameAction, { type: "chooseEncounterIntent" }>,
): ActionResult {
  if (state.phase.kind !== "encounterDecision") return false;
  if (action.side !== "a" && action.side !== "b") return false;
  if (action.intent !== "battle" && action.intent !== "trade" && action.intent !== "greet") return false;
  const encounter = state.phase.encounter;
  const choice = action.side === "a" ? encounter.choiceA : encounter.choiceB;
  if (choice.status !== "pending") return false;
  const playerId = action.side === "a" ? encounter.aPlayerId : encounter.bPlayerId;
  const otherId = action.side === "a" ? encounter.bPlayerId : encounter.aPlayerId;
  if (!state.players[playerId] || !state.players[otherId]) return false;

  // 战斗意向拥有最高优先级，不等待另一方作答。
  if (action.intent === "battle") {
    addHistory(state, `${state.players[playerId].name}选择拔出武器，相遇立即转为战斗！`);
    startBattle(state, "pvp", encounter.aPlayerId, undefined, encounter.bPlayerId);
    return true;
  }

  const selected = { status: "chosen" as const, intent: action.intent };
  if (action.side === "a") encounter.choiceA = selected;
  else encounter.choiceB = selected;
  if (encounter.choiceA.status === "pending" || encounter.choiceB.status === "pending") {
    addHistory(state, `${state.players[playerId].name}已经作出相遇选择，等待对方。`);
    return true;
  }

  if (
    encounter.choiceA.status === "chosen"
    && encounter.choiceB.status === "chosen"
    && encounter.choiceA.intent === "trade"
    && encounter.choiceB.intent === "trade"
  ) {
    state.phase = {
      kind: "tradeOffer",
      trade: {
        aPlayerId: encounter.aPlayerId,
        bPlayerId: encounter.bPlayerId,
        tileIndex: encounter.tileIndex,
        offerA: { status: "pending" },
        offerB: { status: "pending" },
      },
    };
    addHistory(state, `${state.players[encounter.aPlayerId].name}与${state.players[encounter.bPlayerId].name}都愿意交易，开始准备报价。`);
    return true;
  }

  addHistory(state, `${state.players[encounter.aPlayerId].name}与${state.players[encounter.bPlayerId].name}友好招呼后相安无事。`);
  return { resolveTile: encounter.tileIndex };
}
