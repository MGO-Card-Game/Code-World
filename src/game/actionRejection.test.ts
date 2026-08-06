import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "./engine";
import { makeBattle } from "./testSupport";
import type { GameState } from "./types";

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
    expect(gameReducer(state, { type: "submitScrollChoice", side: "a" })).toBe(state);
  });

  it("提交手上没有的卷轴", () => {
    const state = battleState();
    expect(
      gameReducer(state, { type: "submitScrollChoice", side: "a", instanceIds: ["ghost"] }),
    ).toBe(state);
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

  it("被接受的动作一定返回新对象", () => {
    const state = createInitialGame(20260805);
    expect(gameReducer(state, { type: "rollMovement" })).not.toBe(state);
  });
});
