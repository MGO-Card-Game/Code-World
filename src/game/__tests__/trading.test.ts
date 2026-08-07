import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../engine";
import { canAct, currentActor, viewFor } from "../multiplayer";
import type { CombatSide, GameState, PlayerId } from "../types";

function participants(state: GameState) {
  const aPlayerId = state.activePlayerId;
  const bPlayerId = state.turnOrder.find((id) => id !== aPlayerId)!;
  return { aPlayerId, bPlayerId };
}

function encounterState(seed = 7001) {
  const state = createInitialGame(seed);
  const { aPlayerId, bPlayerId } = participants(state);
  const tileIndex = state.map.regions[0].entryIndex;
  state.players[aPlayerId].position = tileIndex;
  state.players[bPlayerId].position = tileIndex;
  state.map.tiles[tileIndex].safeZone = false;
  state.map.tiles[tileIndex].type = "start";
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
  return { state, aPlayerId, bPlayerId, tileIndex };
}

function chooseIntent(state: GameState, side: CombatSide, intent: "trade" | "greet" | "battle") {
  return gameReducer(state, { type: "chooseEncounterIntent", side, intent });
}

function tradeOfferState(seed = 7002) {
  const prepared = encounterState(seed);
  let state = chooseIntent(prepared.state, "a", "trade");
  state = chooseIntent(state, "b", "trade");
  if (state.phase.kind !== "tradeOffer") throw new Error("双方选择交易后应进入报价");
  return { ...prepared, state };
}

describe("相遇意向", () => {
  it("先提交的和平意向对另一方隐藏，任一方选择战斗都会强制开战", () => {
    const prepared = encounterState();
    let state = chooseIntent(prepared.state, "a", "trade");

    expect(state.phase.kind).toBe("encounterDecision");
    expect(currentActor(state)).toBe(prepared.bPlayerId);
    expect(canAct(state, {
      type: "chooseEncounterIntent",
      side: "a",
      intent: "battle",
    }, prepared.aPlayerId)).toBe(false);
    const bView = viewFor(state, prepared.bPlayerId);
    expect(bView.phase.kind).toBe("encounterDecision");
    if (bView.phase.kind === "encounterDecision") {
      expect(bView.phase.encounter.choiceA).toEqual({ status: "submitted" });
    }

    state = chooseIntent(state, "b", "battle");
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind === "battle") {
      expect(state.phase.battle.kind).toBe("pvp");
      expect(state.phase.battle.aPlayerId).toBe(prepared.aPlayerId);
      expect(state.phase.battle.bPlayerId).toBe(prepared.bPlayerId);
    }
  });

  it("只有双方都选择交易才进入报价，否则友好结束并继续结算格子", () => {
    const tradePrepared = encounterState(7003);
    let trading = chooseIntent(tradePrepared.state, "a", "trade");
    trading = chooseIntent(trading, "b", "trade");
    expect(trading.phase.kind).toBe("tradeOffer");

    const peacefulPrepared = encounterState(7004);
    let peaceful = chooseIntent(peacefulPrepared.state, "a", "trade");
    peaceful = chooseIntent(peaceful, "b", "greet");
    expect(peaceful.phase.kind).toBe("turnComplete");
    expect(peaceful.history.some((entry) => entry.text.includes("相安无事"))).toBe(true);
  });

  it("被相遇方掉线超时后按友好招呼处理，不会锁死回合", () => {
    const prepared = encounterState(7010);
    let state = chooseIntent(prepared.state, "a", "trade");
    state.unavailablePlayerIds = [prepared.bPlayerId];

    state = handleDisconnectTimeout(state, prepared.bPlayerId);

    expect(state.phase.kind).toBe("turnComplete");
    expect(state.history.some((entry) => entry.text.includes("相安无事"))).toBe(true);
  });
});

describe("双方交易", () => {
  it("报价提交前彼此隐藏，双方确认后原子交换金币、卷轴和装备", () => {
    const prepared = tradeOfferState();
    let state = prepared.state;
    const a = state.players[prepared.aPlayerId];
    const b = state.players[prepared.bPlayerId];
    a.gold = 100;
    b.gold = 200;
    a.scrolls = [{ instanceId: "scroll-a", kind: "might" }];
    b.scrolls = [{ instanceId: "scroll-b", kind: "guard" }];
    a.equipment = [{ instanceId: "equipment-a", kind: "sword" }];
    b.equipment = [{ instanceId: "equipment-b", kind: "shield" }];

    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "a",
      gold: 20,
      scrollInstanceIds: ["scroll-a"],
      equipmentInstanceIds: ["equipment-a"],
    });
    expect(state.phase.kind).toBe("tradeOffer");
    expect(currentActor(state)).toBe(prepared.bPlayerId);
    expect(canAct(state, {
      type: "submitTradeOffer", side: "a", gold: 1, scrollInstanceIds: [], equipmentInstanceIds: [],
    }, prepared.aPlayerId)).toBe(false);
    expect(canAct(state, {
      type: "submitTradeOffer", side: "b", gold: 1, scrollInstanceIds: [], equipmentInstanceIds: [],
    }, prepared.bPlayerId)).toBe(true);
    const bView = viewFor(state, prepared.bPlayerId);
    if (bView.phase.kind !== "tradeOffer") throw new Error("应仍在报价阶段");
    expect(bView.phase.trade.offerA).toEqual({ status: "submitted" });
    expect(JSON.stringify(bView.phase)).not.toContain("scroll-a");

    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "b",
      gold: 50,
      scrollInstanceIds: ["scroll-b"],
      equipmentInstanceIds: ["equipment-b"],
    });
    expect(state.phase.kind).toBe("tradeConfirmation");
    if (state.phase.kind !== "tradeConfirmation") throw new Error("报价应公开确认");
    expect(state.phase.trade.offerA.scrolls[0].kind).toBe("might");
    expect(state.phase.trade.offerB.scrolls[0].kind).toBe("guard");

    state = gameReducer(state, { type: "confirmTrade", side: "a", accept: true });
    expect(currentActor(state)).toBe(prepared.bPlayerId);
    expect(canAct(state, { type: "confirmTrade", side: "b", accept: true }, prepared.bPlayerId)).toBe(true);
    expect(state.players[prepared.aPlayerId].gold).toBe(100);
    expect(state.players[prepared.aPlayerId].scrolls[0].instanceId).toBe("scroll-a");
    state = gameReducer(state, { type: "confirmTrade", side: "b", accept: true });

    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players[prepared.aPlayerId].gold).toBe(130);
    expect(state.players[prepared.bPlayerId].gold).toBe(170);
    expect(state.players[prepared.aPlayerId].scrolls.map((item) => item.instanceId)).toEqual(["scroll-b"]);
    expect(state.players[prepared.bPlayerId].scrolls.map((item) => item.instanceId)).toEqual(["scroll-a"]);
    expect(state.players[prepared.aPlayerId].equipment.map((item) => item.instanceId)).toEqual(["equipment-b"]);
    expect(state.players[prepared.bPlayerId].equipment.map((item) => item.instanceId)).toEqual(["equipment-a"]);
    expect(state.lastEvents.filter((event) => event.type === "goldChanged")).toHaveLength(2);
  });

  it("任一方取消确认时不转移任何资源", () => {
    const prepared = tradeOfferState(7005);
    let state = prepared.state;
    state.players[prepared.aPlayerId].gold = 100;
    state.players[prepared.bPlayerId].gold = 100;
    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "a",
      gold: 20,
      scrollInstanceIds: [],
      equipmentInstanceIds: [],
    });
    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "b",
      gold: 30,
      scrollInstanceIds: [],
      equipmentInstanceIds: [],
    });
    state = gameReducer(state, { type: "confirmTrade", side: "a", accept: true });
    state = gameReducer(state, { type: "confirmTrade", side: "b", accept: false });

    expect(state.players[prepared.aPlayerId].gold).toBe(100);
    expect(state.players[prepared.bPlayerId].gold).toBe(100);
    expect(state.history.some((entry) => entry.text.includes("取消了交易"))).toBe(true);
  });

  it("报价阶段也可以直接取消", () => {
    const prepared = tradeOfferState(7008);
    const state = gameReducer(prepared.state, { type: "cancelTrade", side: "a" });

    expect(state.phase.kind).toBe("turnComplete");
    expect(state.history.some((entry) => entry.text.includes("取消了交易"))).toBe(true);
  });

  it("装备槽位不兼容时不公开或转移报价，而是要求双方重新报价", () => {
    const prepared = tradeOfferState(7006);
    let state = prepared.state;
    const a = state.players[prepared.aPlayerId];
    const b = state.players[prepared.bPlayerId];
    a.gold = 10;
    a.equipment = [{ instanceId: "weapon-a", kind: "sword" }];
    b.equipment = [{ instanceId: "weapon-b", kind: "sword" }];

    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "a",
      gold: 1,
      scrollInstanceIds: [],
      equipmentInstanceIds: [],
    });
    state = gameReducer(state, {
      type: "submitTradeOffer",
      side: "b",
      gold: 0,
      scrollInstanceIds: [],
      equipmentInstanceIds: ["weapon-b"],
    });

    expect(state.phase.kind).toBe("tradeOffer");
    if (state.phase.kind !== "tradeOffer") throw new Error("槽位冲突应回到报价阶段");
    expect(state.phase.trade.offerA.status).toBe("pending");
    expect(state.phase.trade.offerB.status).toBe("pending");
    expect(state.phase.trade.error).toContain("武器槽位不足");
    expect(state.players[prepared.aPlayerId].equipment.map((item) => item.instanceId)).toEqual(["weapon-a"]);
    expect(state.players[prepared.bPlayerId].equipment.map((item) => item.instanceId)).toEqual(["weapon-b"]);
  });

  it("互换生命护符不会利用卸装顺序免费回血", () => {
    const prepared = tradeOfferState(7009);
    let state = prepared.state;
    const a = state.players[prepared.aPlayerId];
    const b = state.players[prepared.bPlayerId];
    a.maxHp = 24;
    b.maxHp = 24;
    a.hp = 20;
    b.hp = 20;
    a.equipment = [{ instanceId: "charm-a", kind: "charm" }];
    b.equipment = [{ instanceId: "charm-b", kind: "charm" }];
    state = gameReducer(state, {
      type: "submitTradeOffer", side: "a", gold: 0, scrollInstanceIds: [], equipmentInstanceIds: ["charm-a"],
    });
    state = gameReducer(state, {
      type: "submitTradeOffer", side: "b", gold: 0, scrollInstanceIds: [], equipmentInstanceIds: ["charm-b"],
    });
    state = gameReducer(state, { type: "confirmTrade", side: "a", accept: true });
    state = gameReducer(state, { type: "confirmTrade", side: "b", accept: true });

    expect(state.players[prepared.aPlayerId]).toMatchObject({ hp: 20, maxHp: 24 });
    expect(state.players[prepared.bPlayerId]).toMatchObject({ hp: 20, maxHp: 24 });
  });

  it("拒绝空报价、超额金币和不属于报价方的资源", () => {
    const prepared = tradeOfferState(7007);
    const state = prepared.state;
    state.players[prepared.aPlayerId].gold = 10;
    state.players[prepared.bPlayerId].scrolls = [{ instanceId: "other-scroll", kind: "guard" }];

    expect(gameReducer(state, {
      type: "submitTradeOffer", side: "a", gold: 0, scrollInstanceIds: [], equipmentInstanceIds: [],
    })).toBe(state);
    expect(gameReducer(state, {
      type: "submitTradeOffer", side: "a", gold: 11, scrollInstanceIds: [], equipmentInstanceIds: [],
    })).toBe(state);
    expect(gameReducer(state, {
      type: "submitTradeOffer", side: "a", gold: 0, scrollInstanceIds: ["other-scroll"], equipmentInstanceIds: [],
    })).toBe(state);
  });
});
