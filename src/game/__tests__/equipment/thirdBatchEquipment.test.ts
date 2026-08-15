import { describe, expect, it } from "vitest";
import { startBattle } from "../../battle";
import {
  applyEquipmentAfterDefensiveOpposedRoll,
  applyEquipmentBeforeRoll,
  newRollModifiers,
  rollForSide,
} from "../../battleRound";
import { drawableScrollKinds, SCROLLS } from "../../content/scrolls";
import { createInitialGame } from "../../engine";
import { getAttack, getDefense, getDieSidesBonus } from "../../selectors";
import { makeBattle, resolveRound } from "../../testSupport";

describe("第三批装备", () => {
  it("终极之壁将基础攻击向下折半，并把减少值转为防御", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;
    player.baseAttack = 5;
    player.baseDefense = 2;
    player.equipment = [{ instanceId: "wall-1", kind: "ultimateWall" }];

    expect(getAttack(player)).toBe(2);
    expect(getDefense(player)).toBe(5);

    player.baseAttack = 6;
    expect(getAttack(player)).toBe(3);
    expect(getDefense(player)).toBe(5);
  });

  it("诱敌号角每场发一张临时牌，并降低对方下一次攻击结果", () => {
    let state = createInitialGame(2);
    state.players.player1.equipment = [{ instanceId: "horn-1", kind: "lureHorn" }];
    startBattle(state, "pvp", "player1", undefined, "player2");

    const horn = state.players.player1.scrolls.find(
      (scroll) => scroll.kind === "lureHornTaunt",
    );
    expect(horn?.temporary).toBe(true);
    expect(SCROLLS.lureHornTaunt.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("lureHornTaunt");

    if (state.phase.kind !== "battle" || !horn) throw new Error("应已发放号角牌");
    state.phase.battle.attacker = "a";
    state.players.player1.baseAttack = 0;
    state.players.player1.baseDefense = 99;
    state.players.player2.baseAttack = 0;
    state.players.player2.baseDefense = 99;

    state = resolveRound(state, { attack: horn.instanceId });
    state = resolveRound(state);

    const attack = state.lastEvents.find((event) => event.type === "attackRolled");
    expect(attack?.side).toBe("b");
    expect(attack?.flatBonus).toBe(-2);
    if (state.phase.kind !== "battle") throw new Error("测试战斗不应结束");
    expect(state.phase.battle.nextAttackRollPenaltyB).toBeUndefined();
  });

  it("粘液服把防御骰固定为 D1，并将单次伤害封顶为 5", () => {
    let state = createInitialGame(3);
    const defender = state.players.player2;
    defender.equipment = [
      { instanceId: "slime-1", kind: "slimeSuit" },
      { instanceId: "armlet-1", kind: "engravedArmlet" },
    ];
    state.players.player1.baseAttack = 99;
    defender.baseDefense = 0;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpB: 99,
      }),
    };

    const modifiers = newRollModifiers();
    applyEquipmentBeforeRoll(
      state, state.phase.battle, "b", "a", "defense", modifiers,
    );
    const roll = rollForSide(state, state.phase.battle, "b", "defense", modifiers);
    expect(roll).toMatchObject({ sides: 1, dice: [1], sum: 1 });

    state = resolveRound(state);
    const damage = state.lastEvents.find((event) => event.type === "battleDamage");
    expect(damage?.amount).toBe(5);
  });

  it("巨龙之心提供防御骰上限 +2", () => {
    const state = createInitialGame(4);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "heart-1", kind: "dragonHeart" }];
    expect(getDieSidesBonus(player, "defense")).toBe(2);
  });

  it("坚毅披风在攻击骰点更高时为本回合防御 +2", () => {
    const state = createInitialGame(5);
    state.players.player1.equipment = [{ instanceId: "cloak-1", kind: "steadfastCloak" }];
    const battle = makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" });

    const triggered = newRollModifiers();
    applyEquipmentAfterDefensiveOpposedRoll(
      state,
      battle,
      "a",
      "b",
      triggered,
      { sides: 6, dice: [5], sum: 5 },
      { sides: 7, dice: [3], sum: 3 },
    );
    expect(triggered.flatBonus).toBe(2);
    expect(getDieSidesBonus(state.players.player1, "defense")).toBe(1);

    const tied = newRollModifiers();
    applyEquipmentAfterDefensiveOpposedRoll(
      state,
      battle,
      "a",
      "b",
      tied,
      { sides: 6, dice: [3], sum: 3 },
      { sides: 7, dice: [3], sum: 3 },
    );
    expect(tied.flatBonus).toBe(0);
  });
});
