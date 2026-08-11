import { describe, expect, it } from "vitest";
import { EQUIPMENT, type EquipmentDefinition } from "../content/equipment";
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

/** 把本侧防御骰锁在指定点数的测试砧。 */
function lockDefenseAt(value: number): EquipmentDefinition {
  return {
    name: "测试砧",
    description: `把防御骰锁在 ${value}`,
    rarity: "N",
    category: "accessory",
    modifiers: [],
    effects: {
      beforeRoll({ dieKind, modifiers }) {
        if (dieKind !== "defense") return;
        modifiers.fixedRollDice += 1;
        modifiers.fixedRollValue = value;
      },
    },
  };
}

function addProbe(kind: string, definition: EquipmentDefinition) {
  (EQUIPMENT as Record<string, EquipmentDefinition>)[kind] = definition;
  return () => {
    delete (EQUIPMENT as Record<string, EquipmentDefinition>)[kind];
  };
}

describe("磨损铁甲", () => {
  it("每次受到伤害都减少 1，不像灰铁胸甲那样只咬第一口", () => {
    let state = createInitialGame(4242);
    state.players.player1.baseAttack = 8;
    state.players.player2.baseDefense = 0;
    state.players.player2.equipment = [
      { instanceId: "armor-1", kind: "wornIronArmor" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "a";

    state = resolveRound(state);
    const attack = only(state.lastEvents, "attackRolled");
    const defense = only(state.lastEvents, "defenseRolled");
    const raw = Math.max(0, attack.total - defense.total);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(Math.max(0, raw - 1));

    // 第 2 轮对手（穿甲这一侧）攻击，第 3 轮又轮到 player1 攻击，甲应当再次生效
    state = resolveRound(state);
    state = resolveRound(state);
    const secondAttack = only(state.lastEvents, "attackRolled");
    const secondDefense = only(state.lastEvents, "defenseRolled");
    const secondRaw = Math.max(0, secondAttack.total - secondDefense.total);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(Math.max(0, secondRaw - 1));
  });
});

describe("岩心甲", () => {
  it("防御骰掷出 1 时，本次伤害减少 3", () => {
    const remove = addProbe("testLockDefenseOne", lockDefenseAt(1));
    try {
      let state = pvpBattle(7);
      state.players.player1.baseAttack = 8;
      state.players.player2.equipment = [
        { instanceId: "armor-2", kind: "stoneheartArmor" },
        { instanceId: "probe-1", kind: "testLockDefenseOne" as never },
      ];
      if (state.phase.kind !== "battle") throw new Error("unreachable");
      state.phase.battle.attacker = "a";

      state = resolveRound(state);

      const attack = only(state.lastEvents, "attackRolled");
      const defense = only(state.lastEvents, "defenseRolled");
      // 骰面上限 +1 仍然生效，但测试砧把实际点数锁在 1
      expect(defense.sides).toBe(7);
      expect(defense.dice).toEqual([1]);
      const raw = Math.max(0, attack.total - defense.total);
      expect(only(state.lastEvents, "battleDamage").amount).toBe(Math.max(0, raw - 3));
    } finally {
      remove();
    }
  });

  it("没有掷出 1 时不减伤", () => {
    const remove = addProbe("testLockDefenseTwo", lockDefenseAt(2));

    try {
      let state = pvpBattle(7);
      state.players.player1.baseAttack = 8;
      state.players.player2.equipment = [
        { instanceId: "armor-2", kind: "stoneheartArmor" },
        { instanceId: "probe-1", kind: "testLockDefenseTwo" as never },
      ];
      if (state.phase.kind !== "battle") throw new Error("unreachable");
      state.phase.battle.attacker = "a";

      state = resolveRound(state);

      const attack = only(state.lastEvents, "attackRolled");
      const defense = only(state.lastEvents, "defenseRolled");
      expect(defense.dice).toEqual([2]);
      const raw = Math.max(0, attack.total - defense.total);
      expect(only(state.lastEvents, "battleDamage").amount).toBe(raw);
    } finally {
      remove();
    }
  });
});

describe("残月胸甲", () => {
  it("本场战斗第一次受到伤害时伤害减半，此后不再触发", () => {
    let state = createInitialGame(4242);
    state.players.player1.baseAttack = 9;
    state.players.player2.baseDefense = 0;
    state.players.player2.equipment = [
      { instanceId: "cuirass-1", kind: "waningMoonCuirass" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "a";

    state = resolveRound(state);
    const attack = only(state.lastEvents, "attackRolled");
    const defense = only(state.lastEvents, "defenseRolled");
    const raw = Math.max(0, attack.total - defense.total);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(Math.floor(raw / 2));

    const cuirass = () =>
      state.players.player2.equipment.find((item) => item.instanceId === "cuirass-1");
    expect(cuirass()?.battleMemo).toBe(1);

    // 第 2 轮对手（穿甲这一侧）攻击，第 3 轮 player1 再次打中，不应再减半
    state = resolveRound(state);
    state = resolveRound(state);
    const secondAttack = only(state.lastEvents, "attackRolled");
    const secondDefense = only(state.lastEvents, "defenseRolled");
    const secondRaw = Math.max(0, secondAttack.total - secondDefense.total);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(secondRaw);
  });

  it("战斗结束时暗格被回收，不带进下一场", () => {
    let state = createInitialGame(4242);
    state.players.player1.baseAttack = 99;
    state.players.player2.equipment = [
      { instanceId: "cuirass-1", kind: "waningMoonCuirass" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpB: 1,
      }),
    };
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "a";

    state = resolveRound(state);
    expect(state.phase.kind).not.toBe("battle");
    const cuirass = () =>
      state.players.player2.equipment.find((item) => item.instanceId === "cuirass-1");
    expect(cuirass()?.battleMemo).toBeUndefined();
  });
});
