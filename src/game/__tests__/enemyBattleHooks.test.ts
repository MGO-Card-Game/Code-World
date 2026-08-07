import { describe, expect, it } from "vitest";
import {
  ELITE_AFFIXES,
  type EliteAffixDefinition,
} from "../content/enemies";
import { newRollModifiers } from "../battleRound";
import type { BattleHookContext } from "../effects/battleHooks";
import { enemyEffects, enemyStats } from "../selectors";
import { createInitialGame, gameReducer } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type {
  BattleState,
  EliteAffixKind,
  EnemyKind,
  GameEvent,
  GameState,
} from "../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * 一场 PvE 战斗。敌人一侧不是玩家，所以 resolveRound 只替玩家提交。
 *
 * attacker 传 "b" 就是让怪物打这一回合——怪物的攻击侧钩子只有这样才走得到。
 */
function pveBattle(
  seed: number,
  enemyId: EnemyKind,
  enemyAffix: EliteAffixKind | undefined,
  overrides: Partial<BattleState> = {},
): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({
      kind: "pve",
      aPlayerId: "player1",
      enemyId,
      enemyAffix,
      ...overrides,
    }),
  };
  return state;
}

function attackBonusOf(state: GameState) {
  return only(state.lastEvents, "attackRolled").flatBonus;
}

describe("怪物战斗钩子", () => {
  /*
    下面两条盯着 rollForSide 里的怪物分支。那里以前把「没有玩家」等同于
    「没有任何修正」，骰面和骰数修正都会静默失效——不报错、不掉日志，
    只是骰子悄悄小了一圈或少投一颗。两种修正各守一条。
  */
  it("锋锐的：怪物一侧的骰面修正真的生效", () => {
    const plain = resolveRound(pveBattle(20260805, "wolf", undefined, { attacker: "b" }));
    const honed = resolveRound(pveBattle(20260805, "wolf", "honed", { attacker: "b" }));

    expect(only(plain.lastEvents, "attackRolled").sides).toBe(6);
    expect(only(honed.lastEvents, "attackRolled").sides).toBe(8);
  });

  it("岩穴蝠群本体自己的攻击骰面修正生效", () => {
    const state = resolveRound(
      pveBattle(20260805, "caveBats", undefined, { attacker: "b" }),
    );
    expect(only(state.lastEvents, "attackRolled").sides).toBe(7);
  });

  /*
    骰数这一路目前没有正式内容在用——diceCount +1 是多掷一整颗 d6，
    期望值 +3.5，实测对一条词缀来说太重（精英山狼掉到 11% 胜率）。
    没有内容用不等于代码不会跑，所以拿一条探针词缀把这条分支守住。
  */
  it("怪物一侧的骰数修正生效（探针词缀）", () => {
    const affixes = ELITE_AFFIXES as unknown as Record<string, EliteAffixDefinition>;
    affixes.probeExtraDie = {
      name: "多骰的",
      description: "测试用：攻击骰 +1 颗",
      rarity: "N",
      modifiers: [{ type: "diceCount", die: "attack", value: 1 }],
    };
    try {
      const probed = resolveRound(
        pveBattle(20260805, "wolf", "probeExtraDie" as EliteAffixKind, { attacker: "b" }),
      );
      expect(only(probed.lastEvents, "attackRolled").dice).toHaveLength(2);
    } finally {
      delete affixes.probeExtraDie;
    }
  });

  it("淬毒的：只在攻击侧追加伤害", () => {
    const plain = resolveRound(pveBattle(20260805, "wolf", undefined, { attacker: "b" }));
    const venomous = resolveRound(
      pveBattle(20260805, "wolf", "venomous", { attacker: "b" }),
    );
    // 攻防差之外再加 1 点，防御挡不住
    expect(only(venomous.lastEvents, "battleDamage").amount).toBe(
      only(plain.lastEvents, "battleDamage").amount + 1,
    );
  });

  it("淬毒的：怪物防守那一回合不追加伤害", () => {
    const plain = resolveRound(pveBattle(20260805, "wolf", undefined, { attacker: "a" }));
    const venomous = resolveRound(
      pveBattle(20260805, "wolf", "venomous", { attacker: "a" }),
    );
    /*
      防守侧的反伤需要自己的 battleDamage 事件与击倒判定顺序，那套还没做。
      词缀在防守回合悄悄加伤害不会报错，只会让数值算错，所以专门守一条。
      两侧属性因为词缀不同，伤害数字本来就会差，这里只断言"没有多出那 1 点"。
    */
    // 淬毒不带 modifier，精英基础也只加血，所以这一击的伤害应当分毫不差
    expect(only(venomous.lastEvents, "battleDamage").amount).toBe(
      only(plain.lastEvents, "battleDamage").amount,
    );
  });

  it("濒死反扑：低于一半才触发，正好一半不算", () => {
    // 史莱姆当前 6 + 精英基础 4 = 10，半血正好是 5
    expect(enemyStats("slime", "cornered").maxHp).toBe(10);

    for (const [hpB, expected] of [[5, 0], [4, 3]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "slime", "cornered", { attacker: "b", hpB }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  it("霜息：霜牙巨兽高于一半血时攻击 +2，与濒死反扑正好相反", () => {
    // 霜牙巨兽 22 血，半血是 11
    for (const [hpB, expected] of [[11, 0], [12, 2]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "frostFang", undefined, { attacker: "b", hpB }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  it("龙鳞：峰顶巨龙的防御骰由 D6 提升为 D8", () => {
    const state = resolveRound(
      pveBattle(20260805, "dragon", undefined, { kind: "boss", attacker: "a" }),
    );
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(8);
  });

  it("暴怒：峰顶巨龙低于一半血时攻击 +2，正好一半不触发", () => {
    const halfHp = enemyStats("dragon").maxHp / 2;
    for (const [hpB, expected] of [[halfHp, 0], [halfHp - 1, 2]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "dragon", undefined, {
          kind: "boss",
          attacker: "b",
          hpB,
        }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  /*
    重斧要求骰出上限才触发，通过引擎逼出那一面得靠碰种子，读起来全是噪音。
    钩子能不能被调用已经由上面几条经引擎的用例守住了，这里只单独验效果本身。
  */
  it("重斧：攻击骰掷出上限时追加 2 点伤害，多骰只加一次", () => {
    // 走引擎那份构造，RollModifiers 加字段时这里不用跟着改
    const modifiers = newRollModifiers();
    const context = {
      dieKind: "attack",
      modifiers,
      addBattleLog() {},
    } as unknown as BattleHookContext;
    const [effects] = enemyEffects("banditChief");

    effects.afterRoll?.({ ...context, roll: { sides: 6, dice: [3, 4], sum: 7 } });
    expect(modifiers.bonusDamage).toBe(0);

    effects.afterRoll?.({ ...context, roll: { sides: 6, dice: [6, 6], sum: 12 } });
    expect(modifiers.bonusDamage).toBe(2);

    // 防守那一侧不该沾边
    effects.afterRoll?.({
      ...context,
      dieKind: "defense",
      roll: { sides: 6, dice: [6], sum: 6 },
    });
    expect(modifiers.bonusDamage).toBe(2);
  });

  it("雾毒蜘蛛：攻击骰掷出上限时追加 1 点毒伤", () => {
    // 走引擎那份构造，RollModifiers 加字段时这里不用跟着改
    const modifiers = newRollModifiers();
    const context = {
      dieKind: "attack",
      modifiers,
      addBattleLog() {},
    } as unknown as BattleHookContext;
    const [effects] = enemyEffects("mistSpider");

    effects.afterRoll?.({ ...context, roll: { sides: 6, dice: [5], sum: 5 } });
    expect(modifiers.bonusDamage).toBe(0);
    effects.afterRoll?.({ ...context, roll: { sides: 6, dice: [6], sum: 6 } });
    expect(modifiers.bonusDamage).toBe(1);
  });
});

describe("精英怪属性折算", () => {
  it("词缀的加成叠在本体之上，名字带上前缀", () => {
    const wolf = enemyStats("wolf");
    expect(wolf).toMatchObject({
      name: "山狼",
      attack: 2,
      defense: 1,
    });
    // 精英基础只 +4 血，攻防全交给词缀；狂暴 +1 攻
    expect(enemyStats("wolf", "frenzied")).toMatchObject({
      name: "狂暴的山狼",
      maxHp: wolf.maxHp + 4,
      attack: 3,
      defense: 1,
    });
  });

  it("开战血量走折算后的上限，精英怪才不会按本体血量开打", () => {
    const state = createInitialGame(20260805);
    // 先攻由开局投骰决定，这里要的是"轮到 player1"，不能听天由命
    state.activePlayerId = "player1";
    state.players.player1.position = 10;
    // 对手挪远，免得撞上触发相遇战
    state.players.player2.position = 60;
    // 把这一掷可能落到的六格全铺成同一种精英格，移动骰投几点都会进同一场战斗
    for (let id = 11; id <= 16; id += 1) {
      state.map.tiles[id] = {
        id,
        region: "foothill",
        type: "elite",
        label: "测试精英",
        enemyId: "slime",
        eliteAffix: "frenzied",
      };
    }

    const next = gameReducer(state, { type: "rollMovement" });

    if (next.phase.kind !== "battle") throw new Error("应当进入战斗");
    expect(next.phase.battle.enemyAffix).toBe("frenzied");
    expect(next.phase.battle.hpB).toBe(enemyStats("slime", "frenzied").maxHp);
  });
});
