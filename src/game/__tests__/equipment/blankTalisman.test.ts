import { describe, expect, it } from "vitest";
import { startBattle } from "../../battle";
import { createInitialGame } from "../../engine";
import { resolveRound } from "../../testSupport";
import type { GameEvent, GameState } from "../../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * 一场戴着护符开打的 PvP 战斗，a 侧先攻。
 *
 * 必须走 startBattle 而不是手搓 phase：抽签发生在 onBattleStart，
 * 直接构造战斗状态的话那个钩子根本没被调用过。先攻由随机数决定，
 * 所以开完战再按住它——本文件断言的是"攻击面还是防御面"，不能看先攻的脸色。
 */
function talismanBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.players.player1.equipment = [
    { instanceId: "talisman-1", kind: "blankTalisman" },
  ];
  startBattle(state, "pvp", "player1", undefined, "player2");
  if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
  state.phase.battle.attacker = "a";
  return state;
}

const talisman = (state: GameState) =>
  state.players.player1.equipment.find((item) => item.instanceId === "talisman-1")!;

describe("空白护符", () => {
  it("开战时抽签写进暗格，并立刻上一条战报", () => {
    const state = talismanBattle(4242);
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");

    expect(talisman(state).battleMemo).toBeDefined();
    expect(state.phase.battle.log.some((line) => line.includes("空白护符"))).toBe(true);
  });

  it("两面都抽得到，不是恒定一面", () => {
    const engraved = new Set(
      Array.from({ length: 12 }, (_unused, index) =>
        talisman(talismanBattle(index + 1)).battleMemo),
    );
    expect(engraved.size).toBe(2);
  });

  it("同一颗种子重放，抽到的是同一面", () => {
    // 走的是 GameState 上的种子流；换成 Math.random 这条断言就会随机失败
    for (const seed of [1, 7, 4242, 20260805]) {
      expect(talisman(talismanBattle(seed)).battleMemo).toBe(
        talisman(talismanBattle(seed)).battleMemo,
      );
    }
  });

  it("抽到攻击时只抬攻击骰上限，防御骰不受影响", () => {
    let state = talismanBattle(4242);
    // 直接指定抽签结果，两个分支才不用去碰运气挑种子
    talisman(state).battleMemo = 1;

    state = resolveRound(state);

    expect(only(state.lastEvents, "attackRolled").sides).toBe(8);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);
  });

  it("抽到防御时只抬防御骰上限", () => {
    let state = talismanBattle(4242);
    // 护符在 a 侧，而 a 侧先攻，所以这一轮它是攻击方——防御面就该一点忙都帮不上
    talisman(state).battleMemo = 2;

    state = resolveRound(state);

    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);
  });

  it("整场都按同一面算，不逐轮重抽", () => {
    let state = talismanBattle(4242);
    state.players.player1.baseAttack = 0;
    state.players.player2.baseAttack = 0;
    state.players.player1.baseDefense = 99;
    state.players.player2.baseDefense = 99;
    talisman(state).battleMemo = 2;

    // 第 1 轮自己攻击，第 2 轮才轮到自己防守，第 3 轮又是攻击
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);

    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(8);

    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
    expect(talisman(state).battleMemo).toBe(2);
  });

  it("战斗结束时暗格被回收，不带进下一场", () => {
    let state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "talisman-1", kind: "blankTalisman" },
    ];
    state.players.player1.baseAttack = 99;
    startBattle(state, "pve", "player1", "slime");
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    state.phase.battle.attacker = "a";
    expect(talisman(state).battleMemo).toBeDefined();

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("battle");
    expect(talisman(state).battleMemo).toBeUndefined();
  });
});
