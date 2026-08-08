import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
} from "./content/equipment";
import { SCROLLS } from "./content/scrolls";
import { applyEquipmentStats, removeEquipmentStats } from "./resources";
import { addHistory, emit } from "./state";
import type {
  ActionResult,
  CombatSide,
  GameAction,
  GameState,
  Player,
  TradeConfirmationState,
  TradeOffer,
} from "./types";

/**
 * 相遇战之外的另一条相遇出口：报价、复核、原子交换。
 *
 * 三个动作处理函数都以「回到那一格继续结算」收尾，但格子结算在 engine.ts，
 * 所以它们把这件事作为 ActionResult 交回去，而不是反过来依赖 engine。
 */

type TradeParticipants = Pick<
  TradeConfirmationState,
  "aPlayerId" | "bPlayerId" | "tileIndex"
>;

export function tradePlayerId(trade: TradeParticipants, side: CombatSide) {
  return side === "a" ? trade.aPlayerId : trade.bPlayerId;
}

export function tradeOfferHasValue(offer: TradeOffer) {
  return offer.gold > 0 || offer.scrolls.length > 0 || offer.equipment.length > 0;
}

/** 把客户端提交的实例 id 折算成服务端持有物快照，并拒绝重复、越权和非法金币。 */
export function createTradeOffer(
  player: Player,
  action: Extract<GameAction, { type: "submitTradeOffer" }>,
): TradeOffer | undefined {
  if (!Array.isArray(action.scrollInstanceIds) || !Array.isArray(action.equipmentInstanceIds)) {
    return undefined;
  }
  if (!Number.isSafeInteger(action.gold) || action.gold < 0 || action.gold > player.gold) {
    return undefined;
  }
  const scrollIds = [...action.scrollInstanceIds];
  const equipmentIds = [...action.equipmentInstanceIds];
  if (scrollIds.some((id) => typeof id !== "string")) return undefined;
  if (equipmentIds.some((id) => typeof id !== "string")) return undefined;
  if (new Set(scrollIds).size !== scrollIds.length) return undefined;
  if (new Set(equipmentIds).size !== equipmentIds.length) return undefined;

  const scrolls = scrollIds.map((instanceId) =>
    player.scrolls.find((item) => item.instanceId === instanceId),
  );
  const equipment = equipmentIds.map((instanceId) =>
    player.equipment.find((item) => item.instanceId === instanceId),
  );
  if (scrolls.some((item) => !item) || equipment.some((item) => !item)) return undefined;

  const offer: TradeOffer = {
    gold: action.gold,
    scrolls: scrolls.map((item) => ({ ...item! })),
    equipment: equipment.map((item) => ({ ...item! })),
  };
  return tradeOfferHasValue(offer) ? offer : undefined;
}

function equipmentCapacityErrorFor(
  player: Player,
  outgoing: TradeOffer,
  incoming: TradeOffer,
) {
  const outgoingIds = new Set(outgoing.equipment.map((item) => item.instanceId));
  const projected = [
    ...player.equipment.filter((item) => !outgoingIds.has(item.instanceId)),
    ...incoming.equipment,
  ];
  for (const [category, limit] of Object.entries(EQUIPMENT_SLOT_LIMITS)) {
    const count = projected.filter((item) => equipmentCategory(item.kind) === category).length;
    if (count > limit) {
      return `${player.name}的${EQUIPMENT_CATEGORY_NAMES[category as keyof typeof EQUIPMENT_SLOT_LIMITS]}槽位不足`;
    }
  }
  return undefined;
}

export function tradeEquipmentCapacityError(
  a: Player,
  b: Player,
  offerA: TradeOffer,
  offerB: TradeOffer,
) {
  return equipmentCapacityErrorFor(a, offerA, offerB)
    ?? equipmentCapacityErrorFor(b, offerB, offerA);
}

function stillOwnsOffer(player: Player, offer: TradeOffer) {
  if (player.gold < offer.gold) return false;
  return offer.scrolls.every((offered) =>
    player.scrolls.some((item) => item.instanceId === offered.instanceId && item.kind === offered.kind),
  ) && offer.equipment.every((offered) =>
    player.equipment.some((item) => item.instanceId === offered.instanceId && item.kind === offered.kind),
  );
}

function changeTradeGold(state: GameState, player: Player, delta: number) {
  if (delta === 0) return;
  const from = player.gold;
  player.gold += delta;
  emit(state, {
    type: "goldChanged",
    playerId: player.id,
    from,
    to: player.gold,
    reason: "trade",
  });
}

function takeScrolls(player: Player, offer: TradeOffer) {
  const ids = new Set(offer.scrolls.map((item) => item.instanceId));
  const taken = player.scrolls.filter((item) => ids.has(item.instanceId));
  player.scrolls = player.scrolls.filter((item) => !ids.has(item.instanceId));
  return taken;
}

function describeOffer(offer: TradeOffer) {
  const parts: string[] = [];
  if (offer.gold > 0) parts.push(`${offer.gold} 金币`);
  parts.push(...offer.scrolls.map((item) => SCROLLS[item.kind].name));
  parts.push(...offer.equipment.map((item) => EQUIPMENT[item.kind].name));
  return parts.join("、");
}

/** 双方确认后的原子交换；所有权和槽位先全量复核，再进行任何状态改动。 */
export function executeTrade(state: GameState, trade: TradeConfirmationState) {
  const a = state.players[trade.aPlayerId];
  const b = state.players[trade.bPlayerId];
  if (!a || !b) return false;
  if (!stillOwnsOffer(a, trade.offerA) || !stillOwnsOffer(b, trade.offerB)) return false;
  if (tradeEquipmentCapacityError(a, b, trade.offerA, trade.offerB)) return false;

  changeTradeGold(state, a, trade.offerB.gold - trade.offerA.gold);
  changeTradeGold(state, b, trade.offerA.gold - trade.offerB.gold);

  const scrollsFromA = takeScrolls(a, trade.offerA);
  const scrollsFromB = takeScrolls(b, trade.offerB);
  for (const item of scrollsFromA) {
    b.scrolls.push(item);
    emit(state, {
      type: "scrollTransferred",
      fromId: a.id,
      toId: b.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  }
  for (const item of scrollsFromB) {
    a.scrolls.push(item);
    emit(state, {
      type: "scrollTransferred",
      fromId: b.id,
      toId: a.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  }

  const equipmentFromA = trade.offerA.equipment.map((offered) =>
    a.equipment.find((item) => item.instanceId === offered.instanceId)!,
  );
  const equipmentFromB = trade.offerB.equipment.map((offered) =>
    b.equipment.find((item) => item.instanceId === offered.instanceId)!,
  );
  // 先装备收到的物品且不随最大生命提升回血，再卸下交出的物品：这样交换同类生命装备
  // 不会因为中途降低上限再恢复而凭空治疗。
  for (const item of equipmentFromA) applyEquipmentStats(state, b, { ...item }, false);
  for (const item of equipmentFromB) applyEquipmentStats(state, a, { ...item }, false);
  for (const item of equipmentFromA) removeEquipmentStats(state, a, item.instanceId);
  for (const item of equipmentFromB) removeEquipmentStats(state, b, item.instanceId);
  for (const item of equipmentFromA) {
    emit(state, {
      type: "equipmentTransferred",
      fromId: a.id,
      toId: b.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  }
  for (const item of equipmentFromB) {
    emit(state, {
      type: "equipmentTransferred",
      fromId: b.id,
      toId: a.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  }

  addHistory(
    state,
    `${a.name}交出${describeOffer(trade.offerA)}，${b.name}交出${describeOffer(trade.offerB)}，交易完成。`,
  );
  return true;
}

export function submitTradeOffer(
  state: GameState,
  action: Extract<GameAction, { type: "submitTradeOffer" }>,
): ActionResult {
  if (state.phase.kind !== "tradeOffer") return false;
  if (action.side !== "a" && action.side !== "b") return false;
  const trade = state.phase.trade;
  const choice = action.side === "a" ? trade.offerA : trade.offerB;
  if (choice.status !== "pending") return false;
  const player = state.players[tradePlayerId(trade, action.side)];
  const offer = player ? createTradeOffer(player, action) : undefined;
  if (!offer) return false;
  delete trade.error;
  if (action.side === "a") trade.offerA = { status: "offered", offer };
  else trade.offerB = { status: "offered", offer };

  if (trade.offerA.status !== "offered" || trade.offerB.status !== "offered") {
    addHistory(state, `${player.name}已经提交交易报价，等待对方。`);
    return true;
  }
  const a = state.players[trade.aPlayerId];
  const b = state.players[trade.bPlayerId];
  const error = tradeEquipmentCapacityError(a, b, trade.offerA.offer, trade.offerB.offer);
  if (error) {
    trade.offerA = { status: "pending" };
    trade.offerB = { status: "pending" };
    trade.error = `${error}，请双方调整装备报价。`;
    addHistory(state, `交易报价无法装入行囊：${error}，双方需要重新报价。`);
    return true;
  }
  state.phase = {
    kind: "tradeConfirmation",
    trade: {
      aPlayerId: trade.aPlayerId,
      bPlayerId: trade.bPlayerId,
      tileIndex: trade.tileIndex,
      offerA: trade.offerA.offer,
      offerB: trade.offerB.offer,
      confirmationA: "pending",
      confirmationB: "pending",
    },
  };
  addHistory(state, "双方报价已经公开，等待最终确认。互相确认前不会转移任何资源。");
  return true;
}

export function confirmTrade(
  state: GameState,
  action: Extract<GameAction, { type: "confirmTrade" }>,
): ActionResult {
  if (state.phase.kind !== "tradeConfirmation") return false;
  if (action.side !== "a" && action.side !== "b") return false;
  if (typeof action.accept !== "boolean") return false;
  const trade = state.phase.trade;
  const confirmation = action.side === "a" ? trade.confirmationA : trade.confirmationB;
  if (confirmation !== "pending") return false;
  const player = state.players[tradePlayerId(trade, action.side)];
  if (!action.accept) {
    addHistory(state, `${player.name}取消了交易，双方相安无事。`);
    return { resolveTile: trade.tileIndex };
  }
  if (action.side === "a") trade.confirmationA = "accepted";
  else trade.confirmationB = "accepted";
  if (trade.confirmationA === "pending" || trade.confirmationB === "pending") {
    addHistory(state, `${player.name}确认了报价，等待对方最终确认。`);
    return true;
  }
  if (!executeTrade(state, trade)) {
    addHistory(state, "报价中的资源已经变化，交易取消，双方相安无事。");
  }
  return { resolveTile: trade.tileIndex };
}

export function cancelTrade(
  state: GameState,
  action: Extract<GameAction, { type: "cancelTrade" }>,
): ActionResult {
  if (state.phase.kind !== "tradeOffer") return false;
  if (action.side !== "a" && action.side !== "b") return false;
  const trade = state.phase.trade;
  const player = state.players[tradePlayerId(trade, action.side)];
  if (!player) return false;
  addHistory(state, `${player.name}取消了交易，双方相安无事。`);
  return { resolveTile: trade.tileIndex };
}
