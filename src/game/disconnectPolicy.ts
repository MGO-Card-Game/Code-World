import { finishBattle } from "./battle";
import { chooseEncounterIntent } from "./encounters";
import { acknowledgeCasinoResult, leaveCasino } from "./casino";
import {
  chooseBlessing,
  settleUnavailablePvpPenalty,
  settleWaivedPvpPenalty,
} from "./pvpPenalty";
import { acknowledgePveReward, chooseEquipment, chooseStatGrowth } from "./rewards";
import { leaveShop } from "./shop";
import { addHistory, cloneGameState } from "./state";
import { resolveTile } from "./tiles";
import { advanceCompletedTurn } from "./turns";
import { settleActionResult } from "./actionResult";
import { chooseBossChallenge } from "./mapActions";
import { acknowledgeMapEvent } from "./mapEvents";
import type { GameState, Player } from "./types";

/**
 * 联机玩家掉线超过宽限期后的保底结算。只处理此刻必须由该玩家响应的阶段，
 * 防止三、四人局被一个永久离线席位锁死；短暂掉线由服务器宽限期吸收。
 */
export function handleDisconnectTimeout(state: GameState, playerId: Player["id"]): GameState {
  if (
    !state.unavailablePlayerIds.includes(playerId) ||
    !state.players[playerId]
  ) {
    return state;
  }

  const next = cloneGameState(state);
  next.lastEvents = [];
  const timedOut = next.players[playerId];

  switch (next.phase.kind) {
    case "awaitingRoll":
      if (next.activePlayerId !== playerId) return state;
      next.phase = { kind: "turnComplete" };
      addHistory(next, `${timedOut.name}掉线超时，本回合跳过。`);
      advanceCompletedTurn(next);
      return next;
    case "turnComplete":
      if (next.activePlayerId !== playerId) return state;
      addHistory(next, `${timedOut.name}掉线超时，自动结束回合。`);
      advanceCompletedTurn(next);
      return next;
    /*
      选人的是踩中事件格的人，掉线就直接放弃这次针对——被点名的一方不需要
      操作，所以这里不必像相遇那样从候选名单里剔人。
    */
    case "scrollTargetChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      next.phase = { kind: "turnComplete" };
      addHistory(next, `${timedOut.name}掉线超时，放弃本次针对。`);
      advanceCompletedTurn(next);
      return next;
    case "encounterChoice":
      if (next.phase.choice.challengerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，放弃本次相遇战与格子结算。`);
        advanceCompletedTurn(next);
        return next;
      }
      if (!next.phase.choice.opponentIds.includes(playerId)) return state;
      next.phase.choice.opponentIds = next.phase.choice.opponentIds.filter(
        (id) => !next.unavailablePlayerIds.includes(id),
      );
      if (next.phase.choice.opponentIds.length === 0) {
        const tileIndex = next.phase.choice.tileIndex;
        addHistory(next, "同格对手均已掉线，跳过相遇战。");
        resolveTile(next, next.map.tiles[tileIndex], false);
      }
      return next;
    case "encounterDecision": {
      const encounter = next.phase.encounter;
      if (encounter.aPlayerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，放弃本次相遇与格子结算。`);
        advanceCompletedTurn(next);
        return next;
      }
      if (encounter.bPlayerId !== playerId) return state;
      encounter.choiceB = { status: "pending" };
      return settleActionResult(
        next,
        state,
        chooseEncounterIntent(next, { type: "chooseEncounterIntent", side: "b", intent: "greet" }),
      );
    }
    case "tradeOffer":
    case "tradeConfirmation": {
      const trade = next.phase.trade;
      if (trade.aPlayerId !== playerId && trade.bPlayerId !== playerId) return state;
      if (trade.aPlayerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，交易取消并跳过格子结算。`);
        advanceCompletedTurn(next);
      } else {
        addHistory(next, `${timedOut.name}掉线超时，交易取消，双方相安无事。`);
        resolveTile(next, next.map.tiles[trade.tileIndex], false);
      }
      return next;
    }
    case "bossGateChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      chooseBossChallenge(next, false);
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "battle": {
      const battle = next.phase.battle;
      const loserSide = battle.aPlayerId === playerId
        ? "a"
        : battle.bPlayerId === playerId
          ? "b"
          : undefined;
      if (!loserSide) return state;
      finishBattle(next, battle, loserSide === "a" ? "b" : "a");
      const phaseAfterBattle = next.phase as GameState["phase"];
      if (phaseAfterBattle.kind === "pvpPenalty") {
        if (phaseAfterBattle.penalty.waived) {
          settleWaivedPvpPenalty(next);
        } else if (phaseAfterBattle.penalty.loserId === playerId) {
          settleUnavailablePvpPenalty(next);
        }
      }
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    }
    case "blessingChoice":
      if (next.phase.choice.winnerId !== playerId) return state;
      {
        const source = next.phase.choice.source;
        chooseBlessing(next, false);
        if (
          source === "tile" &&
          (next.phase as GameState["phase"]).kind === "turnComplete" &&
          next.activePlayerId === playerId
        ) {
          advanceCompletedTurn(next);
        }
        return next;
      }
    case "pvpPenalty":
      if (next.phase.penalty.loserId !== playerId) return state;
      settleUnavailablePvpPenalty(next);
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "equipmentChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      settleActionResult(next, state, chooseEquipment(next));
      {
        const phaseAfterChoice = next.phase as GameState["phase"];
        if (
          phaseAfterChoice.kind === "pveReward" &&
          phaseAfterChoice.notice.playerId === playerId
        ) {
          acknowledgePveReward(next);
          if ((next.phase as GameState["phase"]).kind === "statGrowthChoice") {
            chooseStatGrowth(next, "maxHp");
          }
        }
      }
      const phaseAfterEquipmentFallback = next.phase as GameState["phase"];
      if (
        phaseAfterEquipmentFallback.kind === "shop" &&
        phaseAfterEquipmentFallback.shop.playerId === playerId
      ) {
        leaveShop(next);
      }
      if (
        phaseAfterEquipmentFallback.kind === "casino" &&
        phaseAfterEquipmentFallback.casino.playerId === playerId
      ) {
        acknowledgeCasinoResult(next);
        leaveCasino(next);
      }
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "pveReward":
      if (next.phase.notice.playerId !== playerId) return state;
      acknowledgePveReward(next);
      if ((next.phase as GameState["phase"]).kind === "statGrowthChoice") {
        chooseStatGrowth(next, "maxHp");
      }
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    /*
      事件通知只是"把话讲完"，掉线的人没什么可决定的，直接替他关掉。关掉后可能落进
      赌场或装备取舍，那两处各自的兜底不在这条分支里——递归回本函数交给它们处理，
      免得把同样的收尾逻辑再抄一遍。
    */
    case "mapEventNotice":
      if (next.phase.notice.playerId !== playerId) return state;
      acknowledgeMapEvent(next);
      if ((next.phase as GameState["phase"]).kind === "turnComplete") {
        if (next.activePlayerId === playerId) advanceCompletedTurn(next);
        return next;
      }
      return handleDisconnectTimeout(next, playerId);
    case "statGrowthChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      // 掉线的人替他点生命上限：三档里只有它不改变这名玩家的战斗风格
      chooseStatGrowth(next, "maxHp");
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "shop":
      if (next.phase.shop.playerId !== playerId) return state;
      leaveShop(next);
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "casino":
      if (next.phase.casino.playerId !== playerId) return state;
      acknowledgeCasinoResult(next);
      leaveCasino(next);
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "gameOver":
      return state;
  }
}
