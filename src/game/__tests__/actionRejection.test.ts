import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "../engine";
import { makeBattle } from "../testSupport";
import type { GameState } from "../types";

/**
 * gameReducer 的约定：动作没被接受时，原样返回传入的那个 state 对象。
 *
 * 服务器靠引用相等决定是回一条错误还是广播新状态（roomStore.applyAction），
 * React 那边靠它跳过重渲染。这条约定必须对**所有**动作成立，
 * 缺一个就会退化成"某些非法动作被静默吞掉"。
 */
function battleState(): GameState {
  const state = createInitialGame(20260805);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("动作被拒时原样返回 state", () => {
  it("阶段不对的动作", () => {
    const state = createInitialGame(20260805); // awaitingRoll
    expect(gameReducer(state, { type: "endTurn" })).toBe(state);
    expect(gameReducer(state, { type: "choosePvpPenalty", choice: "hp" })).toBe(state);
    expect(gameReducer(state, { type: "chooseEquipment" })).toBe(state);
    expect(gameReducer(state, { type: "chooseMapEventScroll", instanceId: "ghost" })).toBe(state);
    expect(gameReducer(state, { type: "chooseMapEventEquipment", instanceId: "ghost" })).toBe(state);
    expect(gameReducer(state, { type: "submitScrollChoice", side: "a" })).toBe(state);
  });

  it("提交手上没有的卷轴", () => {
    const state = battleState();
    expect(
      gameReducer(state, { type: "submitScrollChoice", side: "a", instanceIds: ["ghost"] }),
    ).toBe(state);
  });

  it("地图阶段不能使用不存在或非疗牌卷轴", () => {
    const state = createInitialGame(20260805);
    state.players[state.activePlayerId].scrolls = [
      { instanceId: "might-1", kind: "might" },
    ];

    expect(gameReducer(state, { type: "useMapScroll", instanceId: "ghost" })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId: "might-1" })).toBe(state);
  });

  it("提交时机不对的卷轴", () => {
    const state = battleState();
    // player1 是攻击方，护盾只能防守时打
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];
    expect(
      gameReducer(state, { type: "submitScrollChoice", side: "a", instanceIds: ["guard-1"] }),
    ).toBe(state);
  });

  it("同一侧重复提交", () => {
    const state = battleState();
    const once = gameReducer(state, { type: "submitScrollChoice", side: "a" });
    expect(once).not.toBe(state);
    expect(gameReducer(once, { type: "submitScrollChoice", side: "a" })).toBe(once);
  });

  it("替换不存在或不同类的装备", () => {
    const state = createInitialGame(20260805);
    state.players.player1.equipment = [{ instanceId: "boots-1", kind: "travelerBoots" }];
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "sword-new", kind: "sword" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };

    // 不存在的实例
    expect(
      gameReducer(state, { type: "chooseEquipment", replaceInstanceId: "nope" }),
    ).toBe(state);
    // 存在但不同类：鞋具换不了武器
    expect(
      gameReducer(state, { type: "chooseEquipment", replaceInstanceId: "boots-1" }),
    ).toBe(state);
    // 放弃新装备是合法的，会推进
    expect(gameReducer(state, { type: "chooseEquipment" })).not.toBe(state);
  });

  it("双子杀手不能复制候选之外或已经离手的卷轴", () => {
    const state = createInitialGame(20260805);
    state.players.player1.scrolls = [{ instanceId: "might-1", kind: "might" }];
    state.phase = {
      kind: "mapEventScrollChoice",
      choice: {
        playerId: "player1",
        candidateIds: ["might-1"],
        eventKind: "twinSlayer",
        effectIndex: 0,
      },
    };

    expect(gameReducer(state, {
      type: "chooseMapEventScroll",
      instanceId: "ghost",
    })).toBe(state);
    state.players.player1.scrolls = [];
    expect(gameReducer(state, {
      type: "chooseMapEventScroll",
      instanceId: "might-1",
    })).toBe(state);
  });

  it("武器收藏家不能收取候选之外或已经离手的装备", () => {
    const state = createInitialGame(20260805);
    state.players.player1.equipment = [{ instanceId: "sword-1", kind: "sword" }];
    state.phase = {
      kind: "mapEventEquipmentChoice",
      choice: {
        playerId: "player1",
        candidateIds: ["sword-1"],
        eventKind: "weaponCollector",
        effectIndex: 0,
      },
    };

    expect(gameReducer(state, {
      type: "chooseMapEventEquipment",
      instanceId: "ghost",
    })).toBe(state);
    state.players.player1.equipment = [];
    expect(gameReducer(state, {
      type: "chooseMapEventEquipment",
      instanceId: "sword-1",
    })).toBe(state);
  });

  it("商会驿站不能在金币不足或目标格失效时强制启程", () => {
    const state = createInitialGame(20260812);
    const player = state.players.player1;
    const target = state.map.tiles.find(
      (tile) => tile.region === "foothill" && tile.type === "shop",
    )!;
    player.gold = 99;
    state.phase = {
      kind: "mapEventTravelChoice",
      choice: {
        playerId: player.id,
        targetTileIndex: target.id,
        price: 100,
        eventKind: "commerceOutpost",
        effectIndex: 0,
      },
    };

    expect(gameReducer(state, { type: "chooseMapEventTravel", accept: true })).toBe(state);
    player.gold = 100;
    state.phase.choice.targetTileIndex = state.map.tiles.find(
      (tile) => tile.region === "foothill" && tile.type !== "shop",
    )!.id;
    expect(gameReducer(state, { type: "chooseMapEventTravel", accept: true })).toBe(state);
  });

  it("调和不能转换不足 1 点的来源属性", () => {
    const state = createInitialGame(20260812);
    state.players.player1.baseAttack = 0;
    state.phase = {
      kind: "mapEventHarmonyChoice",
      choice: {
        playerId: "player1",
        amount: 1,
        eventKind: "harmony",
        effectIndex: 0,
      },
    };

    expect(gameReducer(state, {
      type: "chooseMapEventHarmony",
      option: "attackToDefense",
    })).toBe(state);
    expect(gameReducer(state, {
      type: "chooseMapEventHarmony",
      option: "decline",
    })).not.toBe(state);
  });

  it("被接受的动作一定返回新对象", () => {
    const state = createInitialGame(20260805);
    expect(gameReducer(state, { type: "rollMovement" })).not.toBe(state);
  });
});
