import { describe, expect, it } from "vitest";
import { createInitialGame } from "../../engine";
import { makeBattle, resolveRound } from "../../testSupport";
import type { GameEvent, GameState, ScrollKind } from "../../types";

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T) {
  return state.lastEvents.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

function staged(
  attackerKinds: readonly ScrollKind[] = [],
  defenderKinds: readonly ScrollKind[] = [],
) {
  const state = createInitialGame(20260814);
  state.players.player1.scrolls = attackerKinds.map((kind, index) => ({
    instanceId: `attack-${index}`,
    kind,
  }));
  state.players.player2.scrolls = defenderKinds.map((kind, index) => ({
    instanceId: `defense-${index}`,
    kind,
  }));
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("第二批战斗卷轴", () => {
  it("孤注一掷立刻自损 2 点并额外投两颗攻击骰", () => {
    const state = resolveRound(staged(["recklessGamble"]), { attack: "attack-0" });

    expect(eventsOf(state, "attackRolled")[0].dice).toHaveLength(3);
    expect(eventsOf(state, "battleDamage")[0]).toMatchObject({
      targetSide: "a",
      amount: 2,
      hpAfter: 16,
    });
  });

  it("孤注一掷的即时血价可以让出牌者在投骰前战败", () => {
    const initial = staged(["recklessGamble"], ["guard"]);
    if (initial.phase.kind !== "battle") throw new Error("应处于战斗阶段");
    initial.phase.battle.hpA = 2;

    const state = resolveRound(initial, { attack: "attack-0", defense: "defense-0" });

    expect(state.phase.kind).toBe("pvpPenalty");
    if (state.phase.kind !== "pvpPenalty") return;
    expect(state.phase.penalty.winnerId).toBe("player2");
    expect(state.players.player2.scrolls).toHaveLength(1);
    expect(eventsOf(state, "attackRolled")).toHaveLength(0);
  });

  it("极限突破把骰面上限加 3，并在未分胜负的轮末自损 2 点", () => {
    const state = resolveRound(staged(["limitBreak"]), { attack: "attack-0" });

    expect(eventsOf(state, "attackRolled")[0].sides).toBe(9);
    expect(eventsOf(state, "battleDamage").some(
      (event) => event.targetSide === "a" && event.amount === 2 && event.hpAfter === 16,
    )).toBe(true);
  });

  it("同归于尽先对双方造成减防直伤，同时倒下时出牌者判负", () => {
    const initial = staged(["mutualDestruction"]);
    if (initial.phase.kind !== "battle") throw new Error("应处于战斗阶段");
    initial.phase.battle.hpA = 4;
    initial.phase.battle.hpB = 4;
    initial.players.player1.baseDefense = 0;
    initial.players.player2.baseDefense = 0;

    const state = resolveRound(initial, { attack: "attack-0" });

    expect(eventsOf(state, "battleDamage").slice(0, 2).map((event) => ({
      side: event.targetSide,
      amount: event.amount,
    }))).toEqual([
      { side: "b", amount: 4 },
      { side: "a", amount: 4 },
    ]);
    expect(state.phase.kind).toBe("pvpPenalty");
    if (state.phase.kind === "pvpPenalty") {
      expect(state.phase.penalty.winnerId).toBe("player2");
    }
  });

  it("最后壁垒把最终伤害封顶为 1，并跳过防守方的下一次主动攻击", () => {
    const initial = staged([], ["lastBastion"]);
    initial.players.player1.baseAttack = 50;
    initial.players.player2.baseDefense = 0;

    const state = resolveRound(initial, { defense: "defense-0" });

    expect(eventsOf(state, "battleDamage")[0].amount).toBe(1);
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind === "battle") {
      expect(state.phase.battle.attacker).toBe("a");
      expect(state.phase.battle.round).toBe(3);
      expect(state.phase.battle.log.some((line) => line.includes("跳过下一次主动攻击")))
        .toBe(true);
    }
  });

  it("寒霜钉本次攻击 +2，并只压低目标下一次攻击的骰面", () => {
    let state = resolveRound(staged(["frostNail"]), { attack: "attack-0" });
    const firstAttack = eventsOf(state, "attackRolled")[0];
    expect(firstAttack.flatBonus).toBe(2);

    state = resolveRound(state);
    expect(eventsOf(state, "attackRolled")[0].sides).toBe(4);

    state = resolveRound(state);
    expect(eventsOf(state, "attackRolled")[0].sides).toBe(6);
  });
});
