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
  battleWithDamage,
  isBattleEnding,
  isRevealed,
  visualAttacker,
  visualBattleHp,
  visualBattleRound,
  visualHp,
  visualMaxHp,
  visualPosition,
} from "./visualState";
import { createInitialGame, gameReducer } from "../game/engine";
import { makeBattle, resolveRound } from "../game/testSupport";
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
    const battle: BattleState = makeBattle({
      kind: "pve",
      aPlayerId: "player1",
      enemyId: "golem",
      hpA: 14,
      hpB: 8,
      initiativeB: 2,
      round: 2,
    });
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

  it("战斗治疗也会把血量按在治疗前，播到时再回升", () => {
    const battle: BattleState = makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
      hpA: 13,
    });
    const healed: GameEvent = {
      id: 1,
      type: "battleHealed",
      targetSide: "a",
      amount: 3,
      hpBefore: 10,
      hpAfter: 13,
      hpMax: 18,
    };

    expect(visualBattleHp(battle, "a", [healed])).toBe(10);
    expect(visualBattleHp(battle, "a", [])).toBe(13);
  });

  it("攻防归属按住到交接动画播到，骰点不会挂到下一轮的攻击方名下", () => {
    // 攻击方（a 侧）打出 D20，引擎结算完 attacker 立刻翻成 b。
    // 若界面直接读 battle.attacker，这颗 D20 会显示成对手的攻击骰。
    let state = createInitialGame(1234);
    state.players.player1.scrolls = [{ instanceId: "fate-a", kind: "fate" }];
    state.players.player2.scrolls = [];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "fate-a" });
    if (state.phase.kind !== "battle") throw new Error("战斗提前结束，请换个种子");
    const battle = state.phase.battle;
    expect(battle.attacker).toBe("b");
    expect(battle.round).toBe(2);

    let queue = enqueue(createEventQueue(), state.lastEvents);
    let sawAttackRoll = false;
    while (isPlaying(queue)) {
      const playing = queue.current?.event;
      if (playing?.type === "attackRolled") {
        sawAttackRoll = true;
        expect(playing.sides).toBe(20);
        // 骰点正在播，展示上仍是 a 在攻击、仍是第 1 轮
        expect(visualAttacker(battle, pendingEvents(queue))).toBe("a");
        expect(visualBattleRound(battle, pendingEvents(queue))).toBe(1);
      }
      queue = advance(queue, remainingMs(queue)!);
    }

    expect(sawAttackRoll).toBe(true);
    // 队列放空后跟上引擎的真实状态
    expect(visualAttacker(battle, pendingEvents(queue))).toBe("b");
    expect(visualBattleRound(battle, pendingEvents(queue))).toBe(2);
  });

  it("决出胜负的那一批事件里，骰点和 phase 离开 battle 是同时发生的", () => {
    // 这条正是战斗弹层必须 linger 的原因：照 phase 渲染，弹层会赶在
    // 最后一轮的 attackRolled 之前退场，骰子格子永远空着。
    let state = createInitialGame(4242);
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 3 }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("battle");
    const types = state.lastEvents.map((event) => event.type);
    expect(types).toContain("attackRolled");
    expect(types).toContain("battleEnded");

    // 这批事件全都还没播，弹层得留到 battleEnded 播完
    expect(isBattleEnding(null, state.lastEvents)).toBe(true);
  });

  it("battleEnded 播完之前弹层不退场，播完才让位", () => {
    const ended: GameEvent = {
      id: 9,
      type: "battleEnded",
      battleKind: "pve",
      outcome: "playerWon",
      winnerSide: "a",
    };
    const after: GameEvent = {
      id: 10,
      type: "scrollGranted",
      playerId: "player1",
      instanceId: "s-1",
      kind: "might",
    };

    expect(isBattleEnding(null, [ended, after])).toBe(true);
    // 正在播 battleEnded 时它已经不在 pending 里，仍要留着把这段演完
    expect(isBattleEnding(ended, [after])).toBe(true);
    expect(isBattleEnding(after, [])).toBe(false);
  });

  it("最后一击的伤害补进快照，血条不会停在挨打之前", () => {
    // 战斗结束时引擎不再更新 battle 快照，界面手上的还是结算前那份
    const battle: BattleState = makeBattle({
      kind: "pve",
      aPlayerId: "player1",
      enemyId: "slime",
      hpA: 14,
      hpB: 3,
    });
    const damage: GameEvent = {
      id: 1,
      type: "battleDamage",
      targetSide: "b",
      amount: 3,
      hpBefore: 3,
      hpAfter: 0,
      hpMax: 8,
    };

    const patched = battleWithDamage(battle, [damage]);
    expect(patched.hpB).toBe(0);
    expect(patched.hpA).toBe(14);
    // 伤害还没播到时按住在 hpBefore，播完落到补过的终值
    expect(visualBattleHp(patched, "b", [damage])).toBe(3);
    expect(visualBattleHp(patched, "b", [])).toBe(0);
    // 没有伤害事件就原样返回，不制造无谓的新对象
    expect(battleWithDamage(battle, [])).toBe(battle);
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
    // 先预读下一次骰值，再把玩家放到一处泉水前，构造必定回血的局面。
    let state = createInitialGame(20260805);
    const active = state.activePlayerId;
    const preview = gameReducer(state, { type: "rollMovement" });
    const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
    if (movement?.type !== "movementRolled") throw new Error("应该产生移动骰事件");
    const spring = state.map.tiles.find(
      (tile) => tile.type === "spring" && tile.id > movement.value + 6,
    );
    if (!spring) throw new Error("随机地图应该包含可用泉水");
    state.players[active].position = spring.id - movement.value;
    state.players[active].hp = 5;
    state.players[active].maxHp = 18;

    let before = state;
    let queue = createEventQueue();
    before = state;
    state = gameReducer(state, { type: "rollMovement" });

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
