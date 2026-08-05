import { describe, expect, it } from "vitest";
import {
  advance,
  createEventQueue,
  enqueue,
  isPlaying,
  pendingEvents,
  remainingMs,
} from "./eventQueue";
import {
  isRevealed,
  visualBattleHp,
  visualHp,
  visualMaxHp,
  visualPosition,
} from "./visualState";
import { createInitialGame, gameReducer } from "../game/engine";
import type { BattleState, GameEvent, Player } from "../game/types";

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "player1",
    name: "赤焰旅者",
    color: "#ff7a4d",
    hp: 9,
    maxHp: 18,
    baseAttack: 4,
    baseDefense: 2,
    position: 7,
    scrolls: [],
    equipment: [],
    ...overrides,
  };
}

const hpChanged = (id: number, from: number, to: number): GameEvent => ({
  id,
  type: "playerHpChanged",
  playerId: "player1",
  from,
  to,
  maxHp: 18,
  reason: "event",
});

describe("显示数值回拉", () => {
  it("没有待播事件时直接显示引擎的真实数值", () => {
    const subject = player();

    expect(visualHp(subject, [])).toBe(9);
    expect(visualMaxHp(subject, [])).toBe(18);
    expect(visualPosition(subject, [])).toBe(7);
  });

  it("有待播的血量事件时按住在起点", () => {
    const subject = player({ hp: 9 });
    expect(visualHp(subject, [hpChanged(1, 18, 9)])).toBe(18);
  });

  it("多条待播事件时按住最早那条的起点", () => {
    const subject = player({ hp: 9 });
    const pending = [hpChanged(1, 18, 13), hpChanged(2, 13, 9)];

    expect(visualHp(subject, pending)).toBe(18);
    // 第一条播完后只剩第二条，显示值前移到 13
    expect(visualHp(subject, pending.slice(1))).toBe(13);
    // 全部播完后落到引擎真实值
    expect(visualHp(subject, [])).toBe(9);
  });

  it("只按住对应玩家的数值", () => {
    const other = player({ id: "player2", hp: 12 });
    expect(visualHp(other, [hpChanged(1, 18, 9)])).toBe(12);
  });

  it("移动和后退都会按住位置", () => {
    const subject = player({ position: 12 });
    const moved: GameEvent = { id: 1, type: "playerMoved", playerId: "player1", from: 7, to: 12 };
    const retreated: GameEvent = { id: 2, type: "playerRetreated", playerId: "player1", from: 12, to: 9 };

    expect(visualPosition(subject, [moved])).toBe(7);
    expect(visualPosition(player({ position: 9 }), [retreated])).toBe(12);
  });

  it("生命上限变化也会被按住", () => {
    const subject = player({ maxHp: 22 });
    const grew: GameEvent = { id: 1, type: "maxHpChanged", playerId: "player1", from: 18, to: 22 };

    expect(visualMaxHp(subject, [grew])).toBe(18);
  });

  it("战斗内临时血量按 targetSide 分别按住", () => {
    const battle: BattleState = {
      kind: "pve",
      aPlayerId: "player1",
      enemyId: "golem",
      hpA: 14,
      hpB: 8,
      attacker: "a",
      initiativeA: 6,
      initiativeB: 2,
      round: 2,
      log: [],
    };
    const damage: GameEvent = {
      id: 1,
      type: "battleDamage",
      targetSide: "b",
      amount: 7,
      hpBefore: 15,
      hpAfter: 8,
      hpMax: 15,
    };

    expect(visualBattleHp(battle, "b", [damage])).toBe(15);
    // a 侧没有待播伤害，照常显示真实值
    expect(visualBattleHp(battle, "a", [damage])).toBe(14);
    expect(visualBattleHp(battle, "b", [])).toBe(8);
  });

  it("获得动画播完前卡牌先不显形", () => {
    const granted: GameEvent = {
      id: 1,
      type: "scrollGranted",
      playerId: "player1",
      instanceId: "scroll-3",
      kind: "might",
    };

    expect(isRevealed("scroll-3", [granted])).toBe(false);
    expect(isRevealed("scroll-1", [granted])).toBe(true);
    expect(isRevealed("scroll-3", [])).toBe(true);
  });

  it("相遇战转移的资源同样等动画播完才显形", () => {
    const transferred: GameEvent = {
      id: 1,
      type: "equipmentTransferred",
      fromId: "player2",
      toId: "player1",
      instanceId: "equipment-2",
      kind: "sword",
    };

    expect(isRevealed("equipment-2", [transferred])).toBe(false);
  });

  it("跟着真实队列走完一次泉水回血，显示值单调逼近真实值", () => {
    // 造一个必定触发泉水回血的局面：站在 14 号云上清泉前一格
    let state = createInitialGame(20260805);
    const active = state.activePlayerId;
    state.players[active].position = 13;
    state.players[active].hp = 5;
    state.players[active].maxHp = 18;

    let before = state;
    let queue = createEventQueue();
    // 一直投到踩中泉水为止
    for (let step = 0; step < 40; step += 1) {
      if (state.phase.kind !== "awaitingRoll") break;
      before = state;
      state = gameReducer(state, { type: "rollMovement" });
      if (state.lastEvents.some((event) => event.type === "playerHpChanged")) break;
      if (state.phase.kind !== "turnComplete") break;
      state = gameReducer(state, { type: "endTurn" });
    }

    const healEvent = state.lastEvents.find((event) => event.type === "playerHpChanged");
    expect(healEvent).toBeDefined();
    if (healEvent?.type !== "playerHpChanged") throw new Error("unreachable");

    const healed = state.players[healEvent.playerId];
    queue = enqueue(queue, state.lastEvents);

    // 事件还没播到时，显示的是回血前的数值
    expect(healEvent.from).toBe(before.players[healEvent.playerId].hp);
    while (isPlaying(queue) && pendingEvents(queue).includes(healEvent)) {
      expect(visualHp(healed, pendingEvents(queue))).toBe(healEvent.from);
      queue = advance(queue, remainingMs(queue)!);
    }

    // 播到之后放开，显示值等于引擎的最终值
    expect(visualHp(healed, pendingEvents(queue))).toBe(healed.hp);
    expect(healed.hp).toBe(healEvent.to);
  });
});
