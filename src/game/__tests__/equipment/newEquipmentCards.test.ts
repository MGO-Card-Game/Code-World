import { describe, expect, it } from "vitest";
import {
  applyEquipmentBeforeRoll,
  newRollModifiers,
  rollForSide,
} from "../../battleRound";
import { createInitialGame, gameReducer } from "../../engine";
import { getDieSidesBonus } from "../../selectors";
import { makeBattle, resolveRound } from "../../testSupport";
import type { GameEvent, GameState } from "../../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

function pvpBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

function stalemateBattle(seed: number): GameState {
  const state = pvpBattle(seed);
  for (const player of Object.values(state.players)) {
    player.baseAttack = 0;
    player.baseDefense = 99;
  }
  return state;
}

describe("黑铁巨剑", () => {
  it("攻击消耗两次随机结果并取较低值", () => {
    const seed = 20260809;
    const plain = createInitialGame(seed);
    const plainBattle = makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
    });
    const first = rollForSide(
      plain, plainBattle, "a", "attack", newRollModifiers(),
    ).dice[0];
    const second = rollForSide(
      plain, plainBattle, "a", "attack", newRollModifiers(),
    ).dice[0];

    const equipped = createInitialGame(seed);
    equipped.players.player1.equipment = [
      { instanceId: "greatsword-1", kind: "blackIronGreatsword" },
    ];
    const equippedBattle = makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
    });
    const modifiers = newRollModifiers();
    applyEquipmentBeforeRoll(
      equipped, equippedBattle, "a", "b", "attack", modifiers,
    );
    const selected = rollForSide(
      equipped, equippedBattle, "a", "attack", modifiers,
    ).dice[0];

    expect(selected).toBe(Math.min(first, second));
    expect(equipped.rngSeed).toBe(plain.rngSeed);
  });

  it("防御完全盖过攻击时仍额外造成 3 点伤害", () => {
    let state = stalemateBattle(11);
    state.players.player1.equipment = [
      { instanceId: "greatsword-1", kind: "blackIronGreatsword" },
    ];

    state = resolveRound(state);

    expect(only(state.lastEvents, "battleDamage").amount).toBe(3);
  });
});

describe("鬼切", () => {
  it("累计击败 2 次精英后解锁攻击骰上限 +3", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "oni-1", kind: "oniBlade" }];

    player.stageProgress.foothill.eliteVictories = 1;
    expect(getDieSidesBonus(player, "attack")).toBe(0);
    expect(getDieSidesBonus(player, "initiative")).toBe(1);

    player.stageProgress.mountainside.eliteVictories = 1;
    expect(getDieSidesBonus(player, "attack")).toBe(3);
  });

  it("解锁后攻击被完全抵挡也固定造成至少 3 点伤害", () => {
    let state = stalemateBattle(12);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "oni-1", kind: "oniBlade" }];
    player.stageProgress.foothill.eliteVictories = 2;

    state = resolveRound(state);

    expect(only(state.lastEvents, "attackRolled").sides).toBe(9);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(3);
  });
});

describe("招架盾", () => {
  it("完全抵挡后使自己的下一次攻击骰上限 +4，并在使用后清空蓄力", () => {
    let state = stalemateBattle(13);
    state.players.player2.equipment = [
      { instanceId: "parry-1", kind: "parryShield" },
    ];

    state = resolveRound(state);
    expect(state.players.player2.equipment[0].battleMemo).toBe(1);

    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(10);
    expect(state.players.player2.equipment[0].battleMemo).toBeUndefined();
  });
});

describe("命运硬币", () => {
  it("攻击骰和防御骰只会出现最小值或最大值", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = pvpBattle(seed);
      state.players.player1.equipment = [
        { instanceId: `coin-a-${seed}`, kind: "fateCoin" },
      ];
      state.players.player2.equipment = [
        { instanceId: `coin-b-${seed}`, kind: "fateCoin" },
      ];

      state = resolveRound(state);
      const attack = only(state.lastEvents, "attackRolled");
      const defense = only(state.lastEvents, "defenseRolled");
      expect(attack.dice.every((die) => die === 1 || die === attack.sides)).toBe(true);
      expect(defense.dice.every((die) => die === 1 || die === defense.sides)).toBe(true);
    }
  });

  it("不影响移动骰", () => {
    const seed = 20260809;
    const plain = gameReducer(createInitialGame(seed), { type: "rollMovement" });
    const withCoin = createInitialGame(seed);
    withCoin.players.player1.equipment = [
      { instanceId: "coin-1", kind: "fateCoin" },
    ];
    const rolledWithCoin = gameReducer(withCoin, { type: "rollMovement" });

    expect(rolledWithCoin.lastMovementRoll).toBe(plain.lastMovementRoll);
  });
});
