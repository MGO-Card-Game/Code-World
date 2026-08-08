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

/**
 * 一场 a 单方面压制 b 的 PvP 战斗。
 *
 * a 的攻击骰锁在最高面、基础攻击由参数给定，b 的基础防御归零——但 b 仍然要投一颗
 * 防御骰，所以伤害不是定值。断言一律用 rawDamage() 从事件里现算攻防差，
 * 再看减伤效果偏离了多少。
 */
function oneSidedBattle(attack: number, hpB: number): GameState {
  const state = createInitialGame(20260807);
  state.players.player1.baseAttack = attack;
  state.players.player1.equipment = [{ instanceId: "anvil-1", kind: "lockAttackMax" as never }];
  state.players.player2.baseDefense = 0;
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2", hpB }),
  };
  return state;
}

/** 本轮没有任何减伤时应该造成的伤害，即攻防差。 */
function rawDamage(events: GameEvent[]) {
  return Math.max(
    0,
    only(events, "attackRolled").total - only(events, "defenseRolled").total,
  );
}

/** 把攻击骰锁在骰面上限，压掉攻击侧的随机性。 */
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

function addProbe(kind: string, definition: EquipmentDefinition) {
  (EQUIPMENT as Record<string, EquipmentDefinition>)[kind] = definition;
  return () => {
    delete (EQUIPMENT as Record<string, EquipmentDefinition>)[kind];
  };
}

function withAnvil(body: () => void) {
  const remove = addProbe("lockAttackMax", LOCK_ATTACK_MAX);
  try {
    body();
  } finally {
    remove();
  }
}

describe("伤害落地前的装备钩子", () => {
  it("只能把伤害改小，钩子想加伤也加不上去", () => {
    /*
      顺序无关是靠"只能变小"成立的。真要加伤应该走攻击方的 bonusDamage，
      那里是公开算进合计的；减伤时机能加伤的话，防具就成了隐形的伤害来源。
    */
    withAnvil(() => {
      const remove = addProbe("greedyPlate", {
        name: "测试贪甲",
        description: "试图把伤害改大",
        rarity: "N",
        category: "armor",
        modifiers: [],
        effects: {
          beforeDamage({ reduceDamage, keepAtLeast }) {
            reduceDamage(-100);
            keepAtLeast(-100);
          },
        },
      });
      try {
        let state = oneSidedBattle(5, 99);
        state.players.player2.equipment = [
          { instanceId: "greedy-1", kind: "greedyPlate" as never },
        ];

        state = resolveRound(state);

        expect(only(state.lastEvents, "battleDamage").amount)
          .toBe(rawDamage(state.lastEvents));
      } finally {
        remove();
      }
    });
  });

  it("多件装备的减免累加，且与结算顺序无关", () => {
    withAnvil(() => {
      const remove = addProbe("minusOne", {
        name: "测试减伤",
        description: "每次受到的伤害减少 1",
        rarity: "N",
        category: "accessory",
        modifiers: [],
        effects: {
          beforeDamage({ reduceDamage }) {
            reduceDamage(1);
          },
        },
      });
      try {
        const amounts = [["a-1", "a-2"], ["a-2", "a-1"]].map((order) => {
          let state = oneSidedBattle(5, 99);
          state.players.player2.equipment = order.map((instanceId) => ({
            instanceId,
            kind: "minusOne" as never,
          }));
          state = resolveRound(state);
          return only(state.lastEvents, "battleDamage").amount
            - rawDamage(state.lastEvents);
        });
        // 两件各减 1，换顺序结果不变
        expect(amounts).toEqual([-2, -2]);
      } finally {
        remove();
      }
    });
  });

  it("卷轴直伤走同一个入口，减伤照样生效", () => {
    // 巨龙打击以前自己写了一遍扣血，收成 dealBattleDamage 之后钩子对它也生效
    let state = createInitialGame(20260807);
    state.players.player1.scrolls = [{ instanceId: "dragon-1", kind: "dragonStrike" }];
    state.players.player2.baseDefense = 0;
    state.players.player2.equipment = [
      { instanceId: "cuirass-1", kind: "ashenIronCuirass" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "dragon-1" });

    // 直伤没打死人，本轮的攻防照常继续，所以取第一条——卷轴那一下
    const damages = state.lastEvents.filter((event) => event.type === "battleDamage");
    expect(damages.length).toBeGreaterThan(1);
    // 巨龙打击 10 点，减去防御 0，灰铁胸甲再挡掉 1
    expect(damages[0].amount).toBe(9);
  });
});

describe("灰铁胸甲", () => {
  it("是防具 N，防御骰上限 +1", () => {
    expect(EQUIPMENT.ashenIronCuirass.category).toBe("armor");
    expect(EQUIPMENT.ashenIronCuirass.rarity).toBe("N");
    expect(EQUIPMENT.ashenIronCuirass.modifiers).toEqual([
      { type: "dieSides", die: "defense", value: 1 },
    ]);
  });

  it("只减第一次伤害，第二次照常挨满", () => {
    withAnvil(() => {
      let state = oneSidedBattle(5, 99);
      state.players.player2.equipment = [
        { instanceId: "cuirass-1", kind: "ashenIronCuirass" },
      ];

      state = resolveRound(state);
      expect(only(state.lastEvents, "battleDamage").amount)
        .toBe(rawDamage(state.lastEvents) - 1);

      // 第 2 轮 b 攻 a，第 3 轮才轮到 b 再挨一次
      state = resolveRound(state);
      state = resolveRound(state);
      expect(only(state.lastEvents, "battleDamage").amount)
        .toBe(rawDamage(state.lastEvents));
    });
  });

  it("这一下没挨到伤害时不消耗次数", () => {
    /*
      这正是它必须挂 beforeDamage 的理由：防守方在投骰阶段读不到对手的合计，
      压根不知道会不会挨到，只有在伤害入口才分得清"挡住了"和"减了 1"。
    */
    let state = createInitialGame(20260807);
    state.players.player1.baseAttack = 0;
    state.players.player2.baseDefense = 99;
    state.players.player2.equipment = [
      { instanceId: "cuirass-1", kind: "ashenIronCuirass" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(0);
    const cuirass = state.players.player2.equipment[0];
    expect(cuirass.battleMemo).toBeUndefined();
  });
});

describe("不灭王铠", () => {
  it("是防具 PR，防御骰上限 +3", () => {
    expect(EQUIPMENT.undyingKingPlate.category).toBe("armor");
    expect(EQUIPMENT.undyingKingPlate.rarity).toBe("PR");
    expect(EQUIPMENT.undyingKingPlate.modifiers).toEqual([
      { type: "dieSides", die: "defense", value: 3 },
    ]);
  });

  it("致命一击后恢复至一半最大生命，战斗不结束", () => {
    withAnvil(() => {
      let state = oneSidedBattle(99, 4);
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];

      state = resolveRound(state);

      const damage = only(state.lastEvents, "battleDamage");
      expect(damage.hpBefore).toBe(4);
      expect(damage.hpAfter).toBe(4);
      expect(damage.amount).toBe(0);
      const healed = only(state.lastEvents, "battleHealed");
      expect(healed.hpBefore).toBe(4);
      expect(healed.hpAfter).toBe(10);
      expect(healed.amount).toBe(6);
      expect(state.phase.kind).toBe("battle");
    });
  });

  it("低于半血时把伤害压到 0，再补足至半血", () => {
    withAnvil(() => {
      let state = oneSidedBattle(99, 1);
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];

      state = resolveRound(state);

      expect(only(state.lastEvents, "battleDamage").amount).toBe(0);
      expect(only(state.lastEvents, "battleHealed").hpAfter).toBe(10);
      expect(state.phase.kind).toBe("battle");
    });
  });

  it("最大生命为奇数时向上取整", () => {
    withAnvil(() => {
      let state = oneSidedBattle(99, 4);
      state.players.player2.maxHp = 21;
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];

      state = resolveRound(state);

      expect(only(state.lastEvents, "battleHealed").hpAfter).toBe(11);
    });
  });

  it("每场只挡一次，第二次致命伤害照常打死", () => {
    withAnvil(() => {
      let state = oneSidedBattle(99, 4);
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];

      state = resolveRound(state);
      expect(state.phase.kind).toBe("battle");

      // 第 2 轮 b 攻 a，第 3 轮 a 再打一次致命伤害
      state = resolveRound(state);
      state = resolveRound(state);

      expect(only(state.lastEvents, "battleDamage").hpAfter).toBe(0);
      expect(state.phase.kind).not.toBe("battle");
    });
  });

  it("不致命的伤害不消耗次数", () => {
    withAnvil(() => {
      let state = oneSidedBattle(5, 99);
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];

      state = resolveRound(state);

      expect(only(state.lastEvents, "battleDamage").amount)
        .toBe(rawDamage(state.lastEvents));
      expect(state.players.player2.equipment[0].battleMemo).toBeUndefined();
    });
  });

  it("战斗结束后暗格清空，下一场还能再挡一次", () => {
    withAnvil(() => {
      let state = oneSidedBattle(99, 4);
      state.players.player2.equipment = [
        { instanceId: "plate-1", kind: "undyingKingPlate" },
      ];
      const plate = () =>
        state.players.player2.equipment.find((item) => item.instanceId === "plate-1");

      // 第 1 轮挡住
      state = resolveRound(state);
      expect(only(state.lastEvents, "battleHealed").hpAfter).toBe(10);
      expect(plate()?.battleMemo).toBe(1);

      // 第 2 轮 b 攻 a，第 3 轮 a 再打一次致命伤害——这次没得挡，战斗结束
      state = resolveRound(state);
      state = resolveRound(state);
      expect(state.phase.kind).not.toBe("battle");
      expect(plate()?.battleMemo).toBeUndefined();

      // 新开一场，次数回来了
      state.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: "pvp",
          aPlayerId: "player1",
          bPlayerId: "player2",
          hpB: 4,
        }),
      };
      state = resolveRound(state);
      expect(only(state.lastEvents, "battleHealed").hpAfter).toBe(10);
    });
  });
});
