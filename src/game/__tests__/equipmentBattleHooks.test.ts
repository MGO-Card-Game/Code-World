import { describe, expect, it } from "vitest";
import { EQUIPMENT, type EquipmentDefinition } from "../content/equipment";
import { createInitialGame } from "../engine";
import { getDieSidesBonus } from "../selectors";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState } from "../types";

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
 * 一场谁也打不死谁的 PvP 战斗。
 *
 * 跨回合效果至少要观察到同一侧的两次攻击，而攻防每轮交替，所以战斗必须活过
 * 三轮。把双方的攻击归零、防御拉满，伤害恒为 0，轮数就不受随机影响了。
 */
function stalemateBattle(seed: number): GameState {
  const state = pvpBattle(seed);
  for (const player of Object.values(state.players)) {
    player.baseAttack = 0;
    player.baseDefense = 99;
  }
  return state;
}

/** 把本侧攻击骰锁在骰面上限的测试砧。 */
const LOCK_ATTACK_MAX: EquipmentDefinition = {
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
};

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

  it("无名骑士遗甲在战斗生命低于三成时再抬一级防御骰面", () => {
    for (const belowThreshold of [false, true]) {
      let state = pvpBattle(20260805);
      // b 侧是防守方
      state.players.player2.equipment = [
        { instanceId: "armor-2", kind: "namelessKnightArmor" },
      ];
      if (state.phase.kind !== "battle") throw new Error("unreachable");
      const threshold = Math.ceil((state.players.player2.maxHp * 3) / 10);
      state.phase.battle.hpB = belowThreshold ? threshold - 1 : threshold;

      state = resolveRound(state);

      // 6 + 2 是普通 modifier，再 +1 才是钩子的部分
      expect(only(state.lastEvents, "defenseRolled").sides).toBe(belowThreshold ? 9 : 8);
      // 只管防御那一侧，攻击骰不受影响
      expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
    }
  });

  it("遗甲装在攻击方身上时不影响攻击骰", () => {
    let state = pvpBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "armor-1", kind: "namelessKnightArmor" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpA = 1;

    state = resolveRound(state);

    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
  });

  it("双生刺剑在攻击骰点数与上一次攻击不同时加值", () => {
    let state = stalemateBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "rapier-1", kind: "twinRapier" },
    ];

    state = resolveRound(state);
    const first = only(state.lastEvents, "attackRolled");
    // 本场第一次攻击没有前值，不触发
    expect(first.flatBonus).toBe(0);

    // 第 2 轮换对手攻击，自己这把剑不参与；第 3 轮才是它的第二次攻击
    state = resolveRound(state);
    state = resolveRound(state);
    const second = only(state.lastEvents, "attackRolled");
    // 前置条件：这颗种子下两轮点数确实不同，否则测的就不是"触发"了
    expect(second.dice[0]).not.toBe(first.dice[0]);
    expect(second.flatBonus).toBe(1);
  });

  it("两次攻击点数相同时双生刺剑不加值", () => {
    const remove = addProbe("testLockMax", LOCK_ATTACK_MAX);

    try {
      let state = stalemateBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "rapier-1", kind: "twinRapier" },
        { instanceId: "probe-1", kind: "testLockMax" as never },
      ];

      state = resolveRound(state);
      expect(only(state.lastEvents, "attackRolled").dice).toEqual([7]);

      state = resolveRound(state);
      state = resolveRound(state);
      const second = only(state.lastEvents, "attackRolled");
      expect(second.dice).toEqual([7]);
      expect(second.flatBonus).toBe(0);
    } finally {
      remove();
    }
  });

  it("断星剑掷出最高面后，下一次攻击多投一颗骰子", () => {
    const remove = addProbe("testLockMax", LOCK_ATTACK_MAX);

    try {
      let state = stalemateBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "star-1", kind: "starbreakerSword" },
        { instanceId: "probe-1", kind: "testLockMax" as never },
      ];

      state = resolveRound(state);
      const first = only(state.lastEvents, "attackRolled");
      expect(first.sides).toBe(8);
      // 攒下的骰子留给下一次攻击，不被本轮自己吃掉
      expect(first.dice).toEqual([8]);

      // 第 2 轮自己是防守方，额外骰不能花在防御上
      state = resolveRound(state);
      expect(only(state.lastEvents, "defenseRolled").dice).toHaveLength(1);

      state = resolveRound(state);
      expect(only(state.lastEvents, "attackRolled").dice).toEqual([8, 8]);
    } finally {
      remove();
    }
  });

  it("没掷出最高面时断星剑不攒额外骰子", () => {
    const remove = addProbe("testWideDie", {
      name: "测试砧",
      description: "把攻击骰面拉大",
      rarity: "N",
      category: "accessory",
      modifiers: [],
      effects: {
        beforeRoll({ dieKind, modifiers }) {
          // 骰面拉到 D22，掷中最高面的概率低到可以靠固定种子避开
          if (dieKind !== "attack") return;
          modifiers.sidesOverride = 20;
        },
      },
    });

    try {
      let state = stalemateBattle(7);
      state.players.player1.equipment = [
        { instanceId: "star-1", kind: "starbreakerSword" },
        { instanceId: "probe-1", kind: "testWideDie" as never },
      ];

      state = resolveRound(state);
      const first = only(state.lastEvents, "attackRolled");
      // 前置条件：这一颗不能是最高面，否则本用例测的就不是"没攒到"了
      expect(first.dice).not.toContain(first.sides);

      state = resolveRound(state);
      state = resolveRound(state);
      expect(only(state.lastEvents, "attackRolled").dice).toHaveLength(1);
    } finally {
      remove();
    }
  });

  it("回响之剑把攻击骰点数的一半加到下一次防御上", () => {
    const remove = addProbe("testLockMax", LOCK_ATTACK_MAX);

    try {
      let state = stalemateBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "echo-1", kind: "echoBlade" },
        { instanceId: "probe-1", kind: "testLockMax" as never },
      ];

      state = resolveRound(state);
      const attack = only(state.lastEvents, "attackRolled");
      // 骰面锁在 7，余响是 floor(7 / 2)
      expect(attack.dice).toEqual([7]);
      expect(attack.flatBonus).toBe(0);

      // 第 2 轮换对手攻击，自己防守，余响在这里兑现
      state = resolveRound(state);
      expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(3);

      // 只兑现一次：第 4 轮的防御拿到的是第 3 轮攻击新攒的那份，不是叠加
      state = resolveRound(state);
      state = resolveRound(state);
      expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(3);
    } finally {
      remove();
    }
  });

  it("回响之剑攒下的余响不加在自己的攻击上", () => {
    const remove = addProbe("testLockMax", LOCK_ATTACK_MAX);

    try {
      let state = stalemateBattle(20260805);
      state.players.player1.equipment = [
        { instanceId: "echo-1", kind: "echoBlade" },
        { instanceId: "probe-1", kind: "testLockMax" as never },
      ];

      state = resolveRound(state);
      state = resolveRound(state);
      state = resolveRound(state);
      // 第 3 轮又是自己攻击：上一轮防守已经把余响花掉了，攻击不该白拿加值
      expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(0);
    } finally {
      remove();
    }
  });

  it("战斗结束时回收暗格，余势不会带进下一场", () => {
    const remove = addProbe("testLockMax", LOCK_ATTACK_MAX);

    try {
      let state = createInitialGame(4242);
      state.players.player1.equipment = [
        { instanceId: "star-1", kind: "starbreakerSword" },
        { instanceId: "probe-1", kind: "testLockMax" as never },
      ];
      const sword = () =>
        state.players.player1.equipment.find((item) => item.instanceId === "star-1");
      state.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: "pve",
          aPlayerId: "player1",
          enemyId: "slime",
          hpB: 2,
        }),
      };

      // 锁在最高面的一击既打死史莱姆、又满足断星剑的攒骰条件
      state = resolveRound(state);
      expect(state.phase.kind).not.toBe("battle");
      expect(sword()?.battleMemo).toBeUndefined();

      state.phase = {
        kind: "battle",
        battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime" }),
      };
      state = resolveRound(state);
      expect(only(state.lastEvents, "attackRolled").dice).toHaveLength(1);
    } finally {
      remove();
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
