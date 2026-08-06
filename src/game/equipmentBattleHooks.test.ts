import { describe, expect, it } from "vitest";
import { EQUIPMENT, type EquipmentDefinition } from "./content/equipment";
import { createInitialGame } from "./engine";
import { getDieSidesBonus } from "./selectors";
import { makeBattle, resolveRound } from "./testSupport";
import type { GameEvent, GameState } from "./types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** 一场 a 侧先攻的 PvP 战斗，双方属性可控 */
function pvpBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

/**
 * 临时往卡表里塞一张测试卡。
 *
 * 效果直接挂在定义上，所以只有这一个注入点——不像以前还要同步往解析器
 * 注册表里塞一份。用完记得 remove。
 */
function addProbe(kind: string, definition: EquipmentDefinition) {
  (EQUIPMENT as Record<string, EquipmentDefinition>)[kind] = definition;
  return () => {
    delete (EQUIPMENT as Record<string, EquipmentDefinition>)[kind];
  };
}

describe("装备战斗钩子", () => {
  it("beforeRoll 能读到对手的战斗生命值，猎魔短刃据此加值", () => {
    let state = pvpBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "blade-1", kind: "monsterHunterBlade" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    // 对手 8/20，低于一半
    state.phase.battle.hpB = 8;

    state = resolveRound(state);

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.flatBonus).toBe(1);
    // 骰面上限 +1 的部分来自普通 modifier，和钩子无关
    expect(attack.sides).toBe(7);
    expect(attack.total).toBe(attack.base + attack.die + 1);
  });

  it("对手血量不到一半才触发，正好一半不算", () => {
    for (const belowHalf of [false, true]) {
      let state = pvpBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "blade-1", kind: "monsterHunterBlade" },
      ];
      if (state.phase.kind !== "battle") throw new Error("unreachable");
      const opponentMaxHp = state.players.player2.maxHp;
      state.phase.battle.hpB = belowHalf
        ? Math.floor((opponentMaxHp - 1) / 2)
        : Math.ceil(opponentMaxHp / 2);

      state = resolveRound(state);
      expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(belowHalf ? 1 : 0);
    }
  });

  it("防守时不触发，武器只管攻击那一侧", () => {
    let state = pvpBattle(20260805);
    // player2 是防守方，给它装上短刃
    state.players.player2.equipment = [
      { instanceId: "blade-2", kind: "monsterHunterBlade" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpA = 3;

    state = resolveRound(state);

    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(0);
  });

  it("afterRoll 追加的伤害不被防御吸收", () => {
    // 攻击骰锁定在最高面，让旧骑士长剑必定触发
    const remove = addProbe("testMaxRoll", {
      name: "测试砧",
      description: "把攻击骰锁在最高面",
      rarity: "N",
      category: "accessory",
      modifiers: [],
      effects: {
        beforeRoll({ dieKind, modifiers }) {
          if (dieKind !== "attack") return;
          modifiers.minimumRoll = 99;
        },
      },
    });

    try {
      let state = pvpBattle(7);
      state.players.player1.baseAttack = 0;
      state.players.player2.baseDefense = 99;
      state.players.player1.equipment = [
        { instanceId: "sword-1", kind: "oldKnightSword" },
        { instanceId: "probe-1", kind: "testMaxRoll" as never },
      ];

      state = resolveRound(state);

      const attack = only(state.lastEvents, "attackRolled");
      expect(attack.sides).toBe(7);
      expect(attack.dice).toEqual([7]);
      // 防御远高于攻击，攻防差为 0，但追加伤害照样落地
      expect(attack.total).toBeLessThan(only(state.lastEvents, "defenseRolled").total);
      expect(only(state.lastEvents, "battleDamage").amount).toBe(1);
    } finally {
      remove();
    }
  });

  it("没掷出最高面时旧骑士长剑不追加伤害", () => {
    const remove = addProbe("testLowRoll", {
      name: "测试砧",
      description: "把攻击骰面拉大",
      rarity: "N",
      category: "accessory",
      modifiers: [],
      effects: {
        beforeRoll({ dieKind, modifiers }) {
          // 骰面拉大到 D21，掷中最高面的概率低到可以靠固定种子避开
          if (dieKind !== "attack") return;
          modifiers.sidesOverride = 20;
        },
      },
    });

    try {
      let state = pvpBattle(7);
      state.players.player1.equipment = [
        { instanceId: "sword-1", kind: "oldKnightSword" },
        { instanceId: "probe-1", kind: "testLowRoll" as never },
      ];

      state = resolveRound(state);

      const attack = only(state.lastEvents, "attackRolled");
      expect(attack.sides).toBe(21);
      // 前置条件：这一颗不能是最高面，否则本用例测的就不是"没触发"了
      expect(attack.dice).not.toContain(attack.sides);

      const defense = only(state.lastEvents, "defenseRolled");
      const expected = Math.max(0, attack.total - defense.total);
      expect(only(state.lastEvents, "battleDamage").amount).toBe(expected);
    } finally {
      remove();
    }
  });

  it("敌人一侧没有装备，PvE 里钩子安静跳过", () => {
    let state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "blade-1", kind: "monsterHunterBlade" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 2 }),
    };

    state = resolveRound(state);

    // 史莱姆 2/5 血，不到一半，短刃应该生效且不报错
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(1);
  });

  it("寒铁长枪只对精英和首领追加伤害", () => {
    const cases = [
      { kind: "pve" as const, enemyAffix: undefined, bonus: 0 },
      { kind: "pve" as const, enemyAffix: "frenzied" as const, bonus: 1 },
      { kind: "boss" as const, enemyAffix: undefined, bonus: 1 },
    ];

    for (const scenario of cases) {
      let state = createInitialGame(4242);
      state.players.player1.equipment = [
        { instanceId: "spear-1", kind: "coldIronSpear" },
      ];
      state.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: scenario.kind,
          aPlayerId: "player1",
          enemyId: scenario.kind === "boss" ? "dragon" : "slime",
          enemyAffix: scenario.enemyAffix,
        }),
      };

      state = resolveRound(state);

      const attack = only(state.lastEvents, "attackRolled");
      const defense = only(state.lastEvents, "defenseRolled");
      expect(only(state.lastEvents, "battleDamage").amount).toBe(
        Math.max(0, attack.total - defense.total) + scenario.bonus,
      );
    }
  });

  it("血誓指环在战斗生命低于一半时同时强化攻防骰", () => {
    for (const belowHalf of [false, true]) {
      let state = pvpBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "ring-1", kind: "bloodOathRing" },
      ];
      state.players.player2.equipment = [
        { instanceId: "ring-2", kind: "bloodOathRing" },
      ];
      if (state.phase.kind !== "battle") throw new Error("unreachable");
      const maxHp = state.players.player1.maxHp;
      const hp = belowHalf
        ? Math.floor((maxHp - 1) / 2)
        : Math.ceil(maxHp / 2);
      state.phase.battle.hpA = hp;
      state.phase.battle.hpB = hp;

      state = resolveRound(state);

      const expectedSides = belowHalf ? 7 : 6;
      expect(only(state.lastEvents, "attackRolled").sides).toBe(expectedSides);
      expect(only(state.lastEvents, "defenseRolled").sides).toBe(expectedSides);
    }
  });

  it("卡牌定义不进 GameState，挂了函数的装备照样能克隆和序列化", () => {
    /*
      定义里能放函数，唯一的前提就是它不会进状态：reducer 每次都会
      structuredClone 整个 state，联机还要把它 JSON 化广播。
      定义一旦泄漏进去，前者抛 DataCloneError、后者静默丢掉函数。
      这条断言守的就是这件事。
    */
    let state = pvpBattle(7);
    state.players.player1.equipment = [
      { instanceId: "sword-1", kind: "oldKnightSword" },
      { instanceId: "blade-1", kind: "monsterHunterBlade" },
    ];
    state.players.player1.scrolls = [{ instanceId: "fate-1", kind: "fate" }];

    state = resolveRound(state, { attack: "fate-1" });

    expect(() => structuredClone(state)).not.toThrow();
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("afterRoll");
    expect(serialized).not.toContain("beforeRoll");
    // 状态里只该留下实例 ID 和卡牌种类
    expect(state.players.player1.equipment[0]).toEqual({
      instanceId: "sword-1",
      kind: "oldKnightSword",
    });
  });
});

describe("已接入的武器", () => {
  it("带钩子的武器都归在武器表里，骰面加值走普通 modifier", () => {
    for (const kind of ["oldKnightSword", "monsterHunterBlade", "coldIronSpear"] as const) {
      const definition = EQUIPMENT[kind];
      expect(definition.category).toBe("weapon");
      expect(definition.modifiers).toContainEqual({
        type: "dieSides",
        die: "attack",
        value: 1,
      });
      expect(definition.effects).toBeDefined();
    }
  });

  it("数值型新装备直接复用骰面 modifier", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;

    player.equipment = [{ instanceId: "axe-1", kind: "rendingAxe" }];
    expect(getDieSidesBonus(player, "attack")).toBe(2);
    expect(getDieSidesBonus(player, "defense")).toBe(-1);

    player.equipment = [{ instanceId: "wall-1", kind: "heavyBulwark" }];
    expect(getDieSidesBonus(player, "defense")).toBe(2);
    expect(getDieSidesBonus(player, "movement")).toBe(-1);

    player.equipment = [{ instanceId: "pointer-1", kind: "huntersPointer" }];
    expect(getDieSidesBonus(player, "movement")).toBe(1);
  });
});
