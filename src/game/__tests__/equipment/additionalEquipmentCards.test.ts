import { describe, expect, it } from "vitest";
import {
  applyEquipmentAfterRoll,
  applyEquipmentBeforeRoll,
  newRollModifiers,
} from "../../battleRound";
import { dealBattleDamage } from "../../battle";
import { createInitialGame } from "../../engine";
import { makeBattle } from "../../testSupport";
import type { GameState } from "../../types";

function equippedBattle(kind: Parameters<typeof equip>[1], seed = 1) {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  equip(state, kind);
  return state;
}

function equip(
  state: GameState,
  kind:
    | "momentumHammer"
    | "dawnHalberd"
    | "oathkeeperCloak"
    | "duskBellPlate"
    | "lynxBoots"
    | "headwindBoots"
    | "warDrumEarring"
    | "reverseHourglass",
) {
  state.players.player1.equipment = [{ instanceId: `${kind}-1`, kind }];
}

function before(state: GameState, dieKind: "attack" | "defense") {
  if (state.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");
  const modifiers = newRollModifiers();
  applyEquipmentBeforeRoll(
    state,
    state.phase.battle,
    "a",
    "b",
    dieKind,
    modifiers,
  );
  return modifiers;
}

function after(
  state: GameState,
  dieKind: "attack" | "defense",
  dice: readonly number[],
  sides = 7,
) {
  if (state.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");
  const modifiers = newRollModifiers();
  applyEquipmentAfterRoll(
    state,
    state.phase.battle,
    "a",
    "b",
    dieKind,
    modifiers,
    { sides, dice, sum: dice.reduce((total, die) => total + die, 0) },
  );
  return modifiers;
}

describe("新增武器", () => {
  it("蓄势战锤在低点后强化且只消费一次", () => {
    const state = equippedBattle("momentumHammer");

    expect(before(state, "attack").flatBonus).toBe(0);
    after(state, "attack", [2]);
    expect(before(state, "attack").flatBonus).toBe(2);
    expect(before(state, "attack").flatBonus).toBe(0);
  });

  it("晨曦长戟只抬高本场第一次攻击的下限", () => {
    const state = equippedBattle("dawnHalberd");

    expect(before(state, "defense").minimumRoll).toBe(1);
    expect(before(state, "attack").minimumRoll).toBe(4);
    expect(before(state, "attack").minimumRoll).toBe(1);
  });
});

describe("新增防具", () => {
  it("缄誓披风只在对手基础攻击高于自身基础防御时生效", () => {
    const state = equippedBattle("oathkeeperCloak");

    state.players.player1.baseDefense = 4;
    state.players.player2.baseAttack = 5;
    expect(before(state, "defense").flatBonus).toBe(2);

    // 装备提供的防御不参与门槛；只有基础防御追平后才关闭。
    state.players.player1.equipment.push({ instanceId: "shield-1", kind: "shield" });
    expect(before(state, "defense").flatBonus).toBe(2);
    state.players.player1.baseDefense = 5;
    expect(before(state, "defense").flatBonus).toBe(0);
  });

  it("暮钟板甲从第 4 回合起减少 2 点伤害", () => {
    const early = equippedBattle("duskBellPlate");
    if (early.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");
    early.phase.battle.round = 3;
    dealBattleDamage(early, early.phase.battle, "b", "a", 6, (damage) => `${damage}`);
    expect(early.phase.battle.hpA).toBe(12);

    const late = equippedBattle("duskBellPlate");
    if (late.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");
    late.phase.battle.round = 4;
    dealBattleDamage(late, late.phase.battle, "b", "a", 6, (damage) => `${damage}`);
    expect(late.phase.battle.hpA).toBe(14);
  });
});

describe("新增鞋具", () => {
  it("山猫软靴只稳定本场第一次攻击", () => {
    const state = equippedBattle("lynxBoots");

    expect(before(state, "attack").minimumRoll).toBe(2);
    expect(before(state, "attack").minimumRoll).toBe(1);
  });

  it("逆风长靴前 2 回合攻防上限 -1，第 3 回合起攻防上限 +1", () => {
    const state = equippedBattle("headwindBoots");
    if (state.phase.kind !== "battle") throw new Error("测试状态应处于战斗阶段");

    state.phase.battle.round = 2;
    expect(before(state, "attack").sidesOverride).toBe(5);
    expect(before(state, "defense").sidesOverride).toBe(5);
    state.phase.battle.round = 3;
    expect(before(state, "attack").sidesOverride).toBe(7);
    expect(before(state, "defense").sidesOverride).toBe(7);
  });
});

describe("新增饰品", () => {
  it("战鼓耳坠把低点转成下一次相反类型的 +3", () => {
    const state = equippedBattle("warDrumEarring");

    after(state, "attack", [1]);
    expect(before(state, "attack").flatBonus).toBe(0);
    expect(before(state, "defense").flatBonus).toBe(3);

    after(state, "defense", [4, 1]);
    expect(before(state, "attack").flatBonus).toBe(3);
  });

  it("逆刻沙漏分别强化第一次攻击和第一次防御", () => {
    const state = equippedBattle("reverseHourglass");

    expect(before(state, "attack").extraDice).toBe(1);
    expect(before(state, "attack").extraDice).toBe(0);
    expect(before(state, "defense").extraDice).toBe(1);
    expect(before(state, "defense").extraDice).toBe(0);
  });
});
