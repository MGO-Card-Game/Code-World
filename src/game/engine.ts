import { submitScrollChoice } from "./battleRound";
import {
  cloneGameState,
  createInitialGame,
} from "./state";
import { buyShopItem } from "./economy";
import { acknowledgeCasinoResult, leaveCasino, spinCasino } from "./casino";
import { buyShopOffer, leaveShop } from "./shop";
import { cancelTrade, confirmTrade, submitTradeOffer } from "./trading";
import { acknowledgePveReward, chooseEquipment, chooseStatGrowth } from "./rewards";
import {
  acknowledgeMapEvent,
  chooseMapEventEquipment,
  chooseMapEventScroll,
} from "./mapEvents";
import { chooseEncounterIntent, chooseEncounterOpponent } from "./encounters";
import {
  chooseBlessing,
  choosePvpPenalty,
  settleWaivedPvpPenalty,
} from "./pvpPenalty";
import { advanceCompletedTurn, rebaseEventIds } from "./turns";
import { settleActionResult } from "./actionResult";
import {
  buyBossKey,
  chooseBossChallenge,
  chooseScrollTarget,
  openBossGate,
  rollMovement,
  useMapScroll,
} from "./mapActions";
import type {
  GameAction,
  GameState,
  Player,
} from "./types";

/**
 * 动作分发，以及规则层的对外门面。
 *
 * 具体规则都在旁边的模块里：state 是地基，tiles 回答「踩到一格会发生什么」，
 * resources 管背包，battle 与 battleRound 管战斗，encounters / trading /
 * pvpPenalty / rewards 各管一段相遇之后的流程。这里只回答一个问题——
 * 一个 action 该派给谁。掉线策略由 disconnectPolicy 单独负责。
 */

/**
 * 应用一个动作。
 *
 * **约定：动作没被接受时原样返回传入的 state 对象。** 调用方靠引用相等就能判断
 * 「这次提交被拒了」——服务器据此回一条错误而不是广播一个没变化的状态，
 * React 那边则直接跳过重渲染。
 *
 * 合法性判断只写在引擎里这一处。联机层的 canAct 只管授权（阶段、归属、是否已提交），
 * 不重复规则；两者职责分开，规则才不会出现第二份副本。
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "restart") {
    const playerIds = Object.keys(state.players) as Player["id"][];
    const playerNames = Object.fromEntries(
      playerIds.map((id) => [id, state.players[id].name]),
    );
    return rebaseEventIds(
      createInitialGame(action.seed, playerNames, playerIds),
      state.nextEventId,
    );
  }
  const next = cloneGameState(state);
  next.lastEvents = [];

  switch (action.type) {
    case "rollMovement":
      return rollMovement(next) ? next : state;
    case "useMapScroll":
      return useMapScroll(next, action.instanceId, action.distance, action.targetPosition) ? next : state;
    case "endTurn": {
      if (next.phase.kind !== "turnComplete") return state;
      advanceCompletedTurn(next);
      return next;
    }
    case "chooseEncounterOpponent":
      return chooseEncounterOpponent(next, action.opponentId) ? next : state;
    case "chooseScrollTarget":
      return settleActionResult(next, state, chooseScrollTarget(next, action.targetId));
    case "chooseEncounterIntent":
      return settleActionResult(next, state, chooseEncounterIntent(next, action));
    case "submitTradeOffer":
      return settleActionResult(next, state, submitTradeOffer(next, action));
    case "cancelTrade":
      return settleActionResult(next, state, cancelTrade(next, action));
    case "confirmTrade":
      return settleActionResult(next, state, confirmTrade(next, action));
    case "buyBossKey":
      return buyBossKey(next) ? next : state;
    case "openBossGate":
      return openBossGate(next) ? next : state;
    case "chooseBossChallenge":
      return chooseBossChallenge(next, action.challenge) ? next : state;
    case "chooseBlessing":
      return chooseBlessing(next, action.replace, action.replaceInstanceId) ? next : state;
    case "acknowledgePveReward":
      return acknowledgePveReward(next) ? next : state;
    case "acknowledgeMapEvent":
      return acknowledgeMapEvent(next) ? next : state;
    case "chooseMapEventScroll":
      return chooseMapEventScroll(next, action.instanceId) ? next : state;
    case "chooseMapEventEquipment":
      return chooseMapEventEquipment(next, action.instanceId) ? next : state;
    case "buyShopItem":
      return buyShopItem(next, action.item) ? next : state;
    case "buyShopOffer":
      return buyShopOffer(next, action.offerId) ? next : state;
    case "leaveShop":
      return leaveShop(next) ? next : state;
    case "spinCasino":
      return spinCasino(next) ? next : state;
    case "acknowledgeCasinoResult":
      return acknowledgeCasinoResult(next) ? next : state;
    case "leaveCasino":
      return leaveCasino(next) ? next : state;
    case "submitScrollChoice":
      if (!submitScrollChoice(next, action.side, action.instanceIds)) return state;
      settleWaivedPvpPenalty(next);
      return next;
    case "choosePvpPenalty":
      return choosePvpPenalty(next, action) ? next : state;
    case "chooseEquipment":
      return settleActionResult(next, state, chooseEquipment(next, action.replaceInstanceId));
    case "chooseStatGrowth":
      return chooseStatGrowth(next, action.option) ? next : state;
  }
}

/*
  规则层的对外门面。

  界面、联机服务器和测试一律从这里 import，内部怎么拆模块都不影响它们；
  engine.ts 自己则只留回合与格子流程、动作分发这两件事。
*/
export {
  getBattleParticipants,
  getSidePlayer,
} from "./battle";
export { handleDisconnectTimeout } from "./disconnectPolicy";
export { createInitialGame, PLAYER_IDS } from "./state";
