import { describe, expect, it } from "vitest";
import { startBattle } from "../battle";
import { createInitialGame } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState } from "../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** 一场 a 侧先攻的 PvP 战斗，双方属性可控。 */
function pvpBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

/** 谁也打不死谁的 PvP 战斗，用来观察跨回合效果。 */
function stalemateBattle(seed: number): GameState {
  const state = pvpBattle(seed);
  for (const player of Object.values(state.players)) {
    player.baseAttack = 0;
    player.baseDefense = 99;
  }
  return state;
}

describe("逃亡者短靴", () => {
  it("本场战斗第一次结算己方防御骰时，防御骰上限额外 +1", () => {
    let state = stalemateBattle(20260805);
    state.players.player2.equipment = [
      { instanceId: "boots-1", kind: "runnersBoots" },
    ];

    // 第 1 轮：a 攻击，b（穿靴子的一方）防守，应当抬高一级
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(7);

    // 第 2 轮换 b 攻击，靴子不管这一次
    state = resolveRound(state);

    // 第 3 轮 b 第二次防守，暗格已经用掉，不再触发
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);
  });

  it("不影响攻击骰", () => {
    let state = stalemateBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "runnersBoots" },
    ];

    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
  });
});

describe("迅雷战靴", () => {
  it("本场战斗第一次由自己发起攻击时，额外投 1 个攻击骰", () => {
    let state = stalemateBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "stormstepBoots" },
    ];

    // a 先攻，第 1 轮就是自己第一次出手
    state = resolveRound(state);
    const first = only(state.lastEvents, "attackRolled");
    expect(first.sides).toBe(7);
    expect(first.dice).toHaveLength(2);

    // 第 2 轮换对手攻击，第 3 轮才是自己的第二次攻击——不再多投
    state = resolveRound(state);
    state = resolveRound(state);
    const second = only(state.lastEvents, "attackRolled");
    expect(second.dice).toHaveLength(1);
  });

  it("自己是后攻方时，第一轮只防守，不会误触发攻击加值", () => {
    let state = stalemateBattle(20260805);
    state.players.player2.equipment = [
      { instanceId: "boots-2", kind: "stormstepBoots" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "a";

    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);

    // 第 2 轮才是 b 第一次攻击，此时轮次已经是 2，不满足「本场第一次」
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").dice).toHaveLength(1);
  });
});

describe("逐日靴", () => {
  function battle(seed: number) {
    const state = createInitialGame(seed);
    state.players.player1.equipment = [
      { instanceId: `boots-${seed}`, kind: "sunchaserBoots" },
    ];
    startBattle(state, "pvp", "player1", undefined, "player2");
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    for (const player of Object.values(state.players)) {
      player.baseAttack = 0;
      player.baseDefense = 99;
    }
    return state;
  }

  it("每场战斗开始时随机选择本场攻击或防御 +3，不再发临时卷轴", () => {
    const byMemo = new Map<number, GameState>();
    for (let seed = 1; seed <= 100 && byMemo.size < 2; seed += 1) {
      const state = battle(seed);
      const memo = state.players.player1.equipment[0].battleMemo;
      if (memo !== undefined) byMemo.set(memo, state);
      expect(state.players.player1.scrolls).toHaveLength(0);
    }

    expect([...byMemo.keys()].sort()).toEqual([1, 2]);

    let attackState = byMemo.get(1)!;
    if (attackState.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    attackState.phase.battle.attacker = "a";
    attackState = resolveRound(attackState);
    expect(only(attackState.lastEvents, "attackRolled").flatBonus).toBe(3);
    attackState = resolveRound(attackState);
    expect(only(attackState.lastEvents, "defenseRolled").flatBonus).toBe(0);

    let defenseState = byMemo.get(2)!;
    if (defenseState.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    defenseState.phase.battle.attacker = "b";
    defenseState = resolveRound(defenseState);
    expect(only(defenseState.lastEvents, "defenseRolled").flatBonus).toBe(3);
    defenseState = resolveRound(defenseState);
    expect(only(defenseState.lastEvents, "attackRolled").flatBonus).toBe(0);
  });

  it("相同种子会得到相同的加成方向", () => {
    expect(battle(4242).players.player1.equipment[0].battleMemo)
      .toBe(battle(4242).players.player1.equipment[0].battleMemo);
  });
});
