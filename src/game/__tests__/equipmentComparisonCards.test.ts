import { describe, expect, it } from "vitest";
import {
  applyEquipmentAfterOpposedRoll,
  newRollModifiers,
  submitScrollChoice,
} from "../battleRound";
import { createInitialGame } from "../engine";
import {
  getDiceCountBonus,
  getDieSidesBonus,
  playableScrolls,
} from "../selectors";
import { makeBattle } from "../testSupport";
import type { EquipmentKind } from "../content/equipment";

function equippedBattle(kind: EquipmentKind, attacker: "a" | "b" = "a") {
  const state = createInitialGame(20260812);
  state.players.player1.blessings = [];
  state.players.player1.equipment = [{ instanceId: `${kind}-1`, kind }];
  state.phase = {
    kind: "battle",
    battle: makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
      attacker,
    }),
  };
  return state;
}

function compare(
  state: ReturnType<typeof equippedBattle>,
  attackDice: readonly number[],
  defenseDice: readonly number[],
) {
  if (state.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");
  const modifiers = newRollModifiers();
  applyEquipmentAfterOpposedRoll(
    state,
    state.phase.battle,
    "a",
    "b",
    modifiers,
    { sides: 6, dice: attackDice, sum: attackDice.reduce((sum, die) => sum + die, 0) },
    { sides: 6, dice: defenseDice, sum: defenseDice.reduce((sum, die) => sum + die, 0) },
  );
  return modifiers;
}

describe("攻防骰比较装备", () => {
  it("嗜血战甲提供防御骰上限 +1，攻击骰胜出时附加 1D2 伤害", () => {
    const state = equippedBattle("bloodthirstyBattleplate");
    expect(getDieSidesBonus(state.players.player1, "defense")).toBe(1);

    const beforeTrigger = state.rngSeed;
    expect(compare(state, [3], [3]).bonusDamage).toBe(0);
    expect(state.rngSeed).toBe(beforeTrigger);

    const bonus = compare(state, [4], [3]).bonusDamage;
    expect([1, 2]).toContain(bonus);
    expect(state.rngSeed).not.toBe(beforeTrigger);
  });

  it("无影剑降低攻击骰上限，只在攻击骰严格胜出时附加 4 点伤害", () => {
    const state = equippedBattle("shadowlessSword");
    expect(getDieSidesBonus(state.players.player1, "attack")).toBe(-2);
    expect(compare(state, [3], [3]).bonusDamage).toBe(0);
    expect(compare(state, [4], [3]).bonusDamage).toBe(4);
  });
});

describe("魔战肩", () => {
  it("防御骰上限 -2，攻击骰数量 +1", () => {
    const state = equippedBattle("warcasterPauldron");
    const player = state.players.player1;

    expect(getDieSidesBonus(player, "defense")).toBe(-2);
    expect(getDiceCountBonus(player, "attack")).toBe(1);
  });

  it("作为攻击方时只能不出牌，作为防守方时仍可使用卷轴", () => {
    const attacking = equippedBattle("warcasterPauldron", "a");
    const attacker = attacking.players.player1;
    attacker.scrolls = [{ instanceId: "dragon-1", kind: "dragonStrike" }];

    expect(playableScrolls(attacker, "beforeAttackRoll")).toEqual([]);
    expect(submitScrollChoice(attacking, "a", ["dragon-1"])).toBe(false);
    expect(submitScrollChoice(attacking, "a")).toBe(true);

    const defending = equippedBattle("warcasterPauldron", "b");
    const defender = defending.players.player1;
    defender.scrolls = [{ instanceId: "dragon-2", kind: "dragonStrike" }];

    expect(playableScrolls(defender, "beforeDefenseRoll")).toHaveLength(1);
    expect(submitScrollChoice(defending, "a", ["dragon-2"])).toBe(true);
  });
});
