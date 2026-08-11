import { EQUIPMENT } from "./content/equipment";
import {
  acceptDrawnBlessing,
  blessingName,
  detachBlessing,
  receiveTransferredBlessing,
} from "./blessings";
import { pvpGoldTransferAmount, transferPvpGold } from "./economy";
import {
  applyEquipmentStats,
  hasFreeEquipmentSlot,
  removeEquipmentStats,
} from "./resources";
import { pvpHpTransferAmount } from "./selectors";
import { addHistory, emit } from "./state";
import { resolveTile } from "./tiles";
import { advanceCompletedTurn } from "./turns";
import type { GameAction, GameState } from "./types";

/**
 * 相遇战结束之后的两笔账：赐福归属，以及败方要付的那一项代价。
 *
 * 四个函数彼此嵌套得很紧——赐福选择会落进代价阶段，代价阶段又有「败方掉线就
 * 替他付」和「根本付不起就免除」两条旁路，而三者的收尾都是同一件事：回到那一格
 * 继续结算。
 *
 * 这一层排在 tiles 之上，所以直接调 resolveTile 就行，不必像 rewards、encounters
 * 那样把收尾交成 ActionResult——chooseBlessing 尤其依赖这一点：它要在格子结算
 * 之后才判断回合是否该推进，延后结算会读到还没落定的阶段。
 */

function finishPenaltyAndResolveTile(state: GameState, tileIndex: number) {
  resolveTile(state, state.map.tiles[tileIndex], false);
}

export function settleWaivedPvpPenalty(state: GameState) {
  if (state.phase.kind !== "pvpPenalty" || !state.phase.penalty.waived) return false;
  const { loserId, tileIndex } = state.phase.penalty;
  if (
    state.unavailablePlayerIds.includes(loserId) &&
    state.activePlayerId === loserId
  ) {
    state.phase = { kind: "turnComplete" };
    advanceCompletedTurn(state);
    return true;
  }
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
}

export function choosePvpPenalty(
  state: GameState,
  action: Extract<GameAction, { type: "choosePvpPenalty" }>,
) {
  if (state.phase.kind !== "pvpPenalty" || state.phase.penalty.waived) return false;
  const { winnerId, loserId, tileIndex } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];

  if (action.choice === "gold") {
    const amount = transferPvpGold(state, loser, winner);
    if (amount <= 0) return false;
    addHistory(state, `${loser.name}支付 ${amount} 金币给${winner.name}。`);
    finishPenaltyAndResolveTile(state, tileIndex);
    return true;
  }

  if (action.choice === "hp") {
    const amount = pvpHpTransferAmount(winner, loser);
    // 付不出就忽略这次提交，阶段留在原地让他重选。
    // 界面本来就不会画出这个按钮（同一个函数算的），走到这里说明是客户端越权，
    // 仍有资源项可选；两项都付不起的状态会在战斗结束时直接跳过本阶段。
    if (amount <= 0) return false;
    const loserBefore = loser.hp;
    const winnerBefore = winner.hp;
    loser.hp -= amount;
    winner.hp += amount;
    emit(state, {
      type: "playerHpChanged",
      playerId: loser.id,
      from: loserBefore,
      to: loser.hp,
      maxHp: loser.maxHp,
      reason: "pvpTransfer",
    });
    emit(state, {
      type: "playerHpChanged",
      playerId: winner.id,
      from: winnerBefore,
      to: winner.hp,
      maxHp: winner.maxHp,
      reason: "pvpTransfer",
    });
    addHistory(state, `${loser.name}转移 ${amount} 点生命给${winner.name}。`);
    finishPenaltyAndResolveTile(state, tileIndex);
    return true;
  }

  if (!action.instanceId || !action.resourceType) return false;
  if (action.resourceType === "scroll") {
    const index = loser.scrolls.findIndex((item) => item.instanceId === action.instanceId);
    if (index < 0) return false;
    const [item] = loser.scrolls.splice(index, 1);
    winner.scrolls.push(item);
    emit(state, {
      type: "scrollTransferred",
      fromId: loser.id,
      toId: winner.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  } else {
    const item = removeEquipmentStats(state, loser, action.instanceId);
    if (!item) return false;
    emit(state, {
      type: "equipmentTransferred",
      fromId: loser.id,
      toId: winner.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
    if (!hasFreeEquipmentSlot(winner, item.kind)) {
      state.phase = {
        kind: "equipmentChoice",
        choice: {
          playerId: winner.id,
          offered: item,
          source: "transfer",
          resume: { kind: "resolveTile", tileIndex },
        },
      };
      addHistory(
        state,
        `${loser.name}交出${EQUIPMENT[item.kind].name}；${winner.name}需要选择是否替换同类装备。`,
      );
      return true;
    }
    applyEquipmentStats(state, winner, item);
  }
  addHistory(state, `${loser.name}交出一件资源给${winner.name}。`);
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
}

/** 掉线玩家无法选择时按固定顺序自动支付；确实付不起则直接继续。 */
export function settleUnavailablePvpPenalty(state: GameState) {
  if (state.phase.kind !== "pvpPenalty") return false;
  const { winnerId, loserId, tileIndex } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];
  if (state.phase.penalty.waived) return settleWaivedPvpPenalty(state);
  if (pvpGoldTransferAmount(loser) > 0) {
    return choosePvpPenalty(state, { type: "choosePvpPenalty", choice: "gold" });
  }
  if (pvpHpTransferAmount(winner, loser) > 0) {
    return choosePvpPenalty(state, { type: "choosePvpPenalty", choice: "hp" });
  }
  const scroll = loser.scrolls[0];
  if (scroll) {
    return choosePvpPenalty(state, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "scroll",
      instanceId: scroll.instanceId,
    });
  }
  const equipment = loser.equipment[0];
  if (equipment) {
    return choosePvpPenalty(state, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "equipment",
      instanceId: equipment.instanceId,
    });
  }
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
}

/** 槽位已满时，选择放弃新赐福或指定一个已有赐福进行替换。 */
export function chooseBlessing(
  state: GameState,
  replace: boolean,
  replaceInstanceId?: string,
) {
  if (state.phase.kind !== "blessingChoice") return false;
  const choice = state.phase.choice;
  const winner = state.players[choice.winnerId];
  const existing = replace
    ? replaceInstanceId === undefined
      ? winner.blessings[0]
      : winner.blessings.find((blessing) => blessing.instanceId === replaceInstanceId)
    : undefined;
  if (replace && !existing) return false;

  if (choice.source === "tile") {
    if (replace) {
      const existingName = existing ? blessingName(existing) : undefined;
      if (existing) detachBlessing(state, winner, existing.instanceId);
      if (!acceptDrawnBlessing(state, winner, choice.offered)) return false;
      addHistory(
        state,
        existingName
          ? `${winner.name}放弃${existingName}，在「${choice.tileLabel}」接纳了${blessingName(choice.offered)}。`
          : `${winner.name}在「${choice.tileLabel}」接纳了${blessingName(choice.offered)}。`,
      );
    } else {
      addHistory(
        state,
        `${winner.name}保留当前赐福，${blessingName(choice.offered)}的力量从「${choice.tileLabel}」消散。`,
      );
    }
    state.phase = { kind: "turnComplete" };
    return true;
  }

  const {
    winnerId,
    loserId,
    offered,
    tileIndex,
    penaltyWaived,
    penaltyWaiveReason,
  } = choice;
  const loser = state.players[loserId];

  if (replace) {
    const existingName = existing ? blessingName(existing) : undefined;
    if (existing) detachBlessing(state, winner, existing.instanceId);
    if (!receiveTransferredBlessing(state, winner, loserId, offered)) return false;
    addHistory(
      state,
      existingName
        ? `${winner.name}放弃${existingName}，接纳了${loser.name}的${blessingName(offered)}。`
        : `${winner.name}接纳了${loser.name}的${blessingName(offered)}。`,
    );
  } else {
    addHistory(
      state,
      `${winner.name}保留已有赐福，${loser.name}失去的${blessingName(offered)}随之消散。`,
    );
  }

  state.phase = {
    kind: "pvpPenalty",
    penalty: {
      winnerId,
      loserId,
      tileIndex,
      waived: penaltyWaived,
      waiveReason: penaltyWaiveReason,
    },
  };
  if (penaltyWaived) return settleWaivedPvpPenalty(state);
  // 败方可能早已掉线超时；赢家作出选择后不能再等待一个已经不会触发的计时器。
  if (state.unavailablePlayerIds.includes(loserId)) {
    settleUnavailablePvpPenalty(state);
    if (
      (state.phase as GameState["phase"]).kind === "turnComplete" &&
      state.activePlayerId === loserId
    ) {
      advanceCompletedTurn(state);
    }
  }
  return true;
}
