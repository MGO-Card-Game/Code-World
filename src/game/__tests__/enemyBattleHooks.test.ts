import { describe, expect, it } from "vitest";
import {
  ELITE_AFFIXES,
  ELITE_BASE_MODIFIERS,
  enemyTier,
  type EliteAffixDefinition,
} from "../content/enemies";
import { newRollModifiers } from "../battleRound";
import type { BattleHookContext, EnemyDamageContext } from "../effects/battleHooks";
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

function allOf<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = allOf(events, type);
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

/** 山匪头目先攻的一场首领战。玩家血量默认拉高，好让开场那两击都落在场上。 */
function banditChiefBattle(seed: number, playerHp = 60): GameState {
  const state = pveBattle(seed, "banditChief", undefined, {
    kind: "boss",
    attacker: "b",
    hpA: playerHp,
    hpB: 28,
  });
  state.players.player1.maxHp = 60;
  state.players.player1.hp = playerHp;
  return state;
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

  it("敏捷的：怪物防御骰上限增加 2", () => {
    const plain = resolveRound(pveBattle(20260805, "wolf", undefined, { attacker: "a" }));
    const agile = resolveRound(pveBattle(20260805, "wolf", "agile", { attacker: "a" }));

    expect(only(plain.lastEvents, "defenseRolled").sides).toBe(6);
    expect(only(agile.lastEvents, "defenseRolled").sides).toBe(8);
  });

  it("岩穴蝠群本体自己的攻击骰面修正生效", () => {
    const state = resolveRound(
      pveBattle(20260805, "caveBats", undefined, { attacker: "b" }),
    );
    expect(only(state.lastEvents, "attackRolled").sides).toBe(7);
  });

  it("独立精英怪的本体能力生效，不依赖词条", () => {
    const fullHp = resolveRound(
      pveBattle(20260805, "razorbackAlpha", undefined, { attacker: "b", hpB: 18 }),
    );
    const wounded = resolveRound(
      pveBattle(20260805, "razorbackAlpha", undefined, { attacker: "b", hpB: 17 }),
    );
    expect(attackBonusOf(fullHp)).toBe(2);
    expect(attackBonusOf(wounded)).toBe(0);

    const halfHp = resolveRound(
      pveBattle(20260805, "frostWraith", undefined, { attacker: "a", hpB: 12 }),
    );
    const belowHalf = resolveRound(
      pveBattle(20260805, "frostWraith", undefined, { attacker: "a", hpB: 11 }),
    );
    expect(only(halfHp.lastEvents, "defenseRolled").flatBonus).toBe(0);
    expect(only(belowHalf.lastEvents, "defenseRolled").flatBonus).toBe(2);
  });

  it("黑曜镇守者把任意来源的单次伤害封顶为 5", () => {
    const state = pveBattle(20260805, "obsidianSentinel", undefined, { attacker: "a" });
    state.players.player1.baseAttack = 99;

    const resolved = resolveRound(state);

    expect(only(resolved.lastEvents, "battleDamage").amount).toBe(5);
    expect(resolved.phase.kind === "battle" ? resolved.phase.battle.log : [])
      .toContain("黑曜躯壳化解冲击，本次伤害被压到 5 点。");
  });

  it("看守者飞龙低于半血时攻击 +2，正好半血不触发", () => {
    const halfHp = resolveRound(
      pveBattle(20260805, "watcherWyvern", undefined, { attacker: "b", hpB: 15 }),
    );
    const belowHalf = resolveRound(
      pveBattle(20260805, "watcherWyvern", undefined, { attacker: "b", hpB: 14 }),
    );

    expect(attackBonusOf(halfHp)).toBe(0);
    expect(attackBonusOf(belowHalf)).toBe(2);
  });

  it("诡异肉块完成第三次攻击后自毁，词条加血不会让它残留", () => {
    const maxHp = enemyStats("uncannyFlesh", "honed").maxHp;
    let state = pveBattle(20260805, "uncannyFlesh", "honed", {
      attacker: "b",
      hpB: maxHp,
    });
    state.players.player1.baseDefense = 99;

    for (let expected = 1; expected <= 2; expected += 1) {
      state = resolveRound(state);
      expect(state.phase.kind).toBe("battle");
      if (state.phase.kind !== "battle") throw new Error("前两次攻击后战斗应继续");
      expect(state.phase.battle.enemyAttacksPerformed).toBe(expected);
      expect(state.phase.battle.hpB).toBe(maxHp);
      state.phase.battle.attacker = "b";
    }

    state = resolveRound(state);

    expect(state.phase.kind).toBe("pveReward");
    expect(state.lastEvents).toContainEqual(expect.objectContaining({
      type: "battleDamage",
      targetSide: "b",
      amount: maxHp,
      hpAfter: 0,
    }));
  });

  it("诡异肉块第三击先击倒玩家时，玩家战败且不会改判为自毁胜利", () => {
    let state = pveBattle(20260805, "uncannyFlesh", undefined, {
      attacker: "b",
      hpA: 1,
      hpB: 100,
      enemyAttacksPerformed: 2,
    });
    state.players.player1.baseDefense = -99;

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("pveReward");
    expect(state.lastEvents.filter(
      (event) => event.type === "battleDamage" && event.targetSide === "b",
    )).toHaveLength(0);
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
    const halfHp = enemyStats("slime", "cornered").maxHp / 2;
    expect(Number.isInteger(halfHp)).toBe(true);

    for (const [hpB, expected] of [[halfHp, 0], [halfHp - 1, 3]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "slime", "cornered", { attacker: "b", hpB }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  it("霜锋之牙：霜牙巨兽高于 20 点生命时攻击 +2", () => {
    for (const [hpB, expected] of [[20, 0], [21, 2]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "frostFang", undefined, { attacker: "b", hpB }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  it("霜冻之铠：造成伤害后让玩家下一次攻击 -2，零伤害不触发", () => {
    let damaged = pveBattle(20260805, "frostFang", undefined, {
      kind: "boss",
      attacker: "b",
      hpA: 100,
      hpB: 40,
    });
    damaged.players.player1.hp = 100;
    damaged.players.player1.maxHp = 100;
    damaged = resolveRound(damaged);
    expect(damaged.phase.kind).toBe("battle");
    if (damaged.phase.kind !== "battle") throw new Error("玩家应在霜牙攻击后存活");
    expect(damaged.phase.battle.nextPlayerAttackPenalty).toBe(2);

    damaged = resolveRound(damaged);
    expect(only(damaged.lastEvents, "attackRolled").flatBonus).toBe(-2);
    expect(damaged.phase.kind === "battle" ? damaged.phase.battle.nextPlayerAttackPenalty : 0)
      .toBe(0);

    let blocked = pveBattle(20260805, "frostFang", undefined, {
      kind: "boss",
      attacker: "b",
      hpB: 40,
    });
    blocked.players.player1.baseDefense = 99;
    blocked = resolveRound(blocked);
    expect(blocked.phase.kind === "battle" ? blocked.phase.battle.nextPlayerAttackPenalty : 0)
      .toBe(0);
  });

  it("龙鳞与暴怒：70 血前为 D8 防御，低于 70 后攻强守弱", () => {
    const healthy = resolveRound(
      pveBattle(20260805, "dragon", undefined, {
        kind: "boss",
        attacker: "a",
        hpB: 100,
      }),
    );
    expect(only(healthy.lastEvents, "defenseRolled")).toMatchObject({
      sides: 8,
      flatBonus: 0,
    });

    const enragedDefense = resolveRound(
      pveBattle(20260805, "dragon", undefined, {
        kind: "boss",
        attacker: "a",
        hpB: 69,
      }),
    );
    expect(only(enragedDefense.lastEvents, "defenseRolled")).toMatchObject({
      sides: 6,
      flatBonus: -2,
    });

    for (const [hpB, expectedBonus, expectedSides] of [
      [70, 0, 6],
      [69, 2, 8],
      [40, 2, 8],
    ] as const) {
      const state = resolveRound(
        pveBattle(20260805, "dragon", undefined, {
          kind: "boss",
          attacker: "b",
          hpB,
        }),
      );
      expect(only(state.lastEvents, "attackRolled")).toMatchObject({
        flatBonus: expectedBonus,
        sides: expectedSides,
      });
    }
  });

  it("真·巨龙打击：低于 40 血时攻击再 +2，掷骰前造成可被防御减免的 10 点伤害", () => {
    let state = pveBattle(20260805, "dragon", undefined, {
      kind: "boss",
      attacker: "b",
      hpA: 100,
      hpB: 39,
    });
    state.players.player1.hp = 100;
    state.players.player1.maxHp = 100;
    state.players.player1.baseDefense = 2;

    state = resolveRound(state);

    expect(only(state.lastEvents, "attackRolled")).toMatchObject({
      flatBonus: 4,
      sides: 8,
    });
    const damageEvents = state.lastEvents.filter(
      (event) => event.type === "battleDamage" && event.targetSide === "a",
    );
    expect(damageEvents[0]).toMatchObject({ amount: 8, hpBefore: 100, hpAfter: 92 });
    expect(state.lastEvents.findIndex((event) => event.type === "battleDamage"))
      .toBeLessThan(state.lastEvents.findIndex((event) => event.type === "attackRolled"));
  });

  it("真·巨龙打击在掷骰前击倒玩家时，立即结束战斗且不再投骰", () => {
    let state = pveBattle(20260805, "dragon", undefined, {
      kind: "boss",
      attacker: "b",
      hpA: 8,
      hpB: 39,
    });
    state.players.player1.hp = 8;
    state.players.player1.baseDefense = 2;

    state = resolveRound(state);

    expect(state.phase.kind).toBe("turnComplete");
    expect(state.lastEvents.some((event) => event.type === "attackRolled")).toBe(false);
    expect(state.lastEvents).toContainEqual(expect.objectContaining({
      type: "battleDamage",
      targetSide: "a",
      amount: 8,
      hpAfter: 0,
    }));
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

  /*
    动作如潮追加的是**完整一击**，不是把第一击的伤害翻倍。差别在事件流里看得最清楚：
    两条 attackRolled、两条 battleDamage，各自投骰、各自过一遍减伤。
  */
  it("动作如潮：头目开场的攻击回合结算两次攻击", () => {
    const state = resolveRound(banditChiefBattle(20260805));

    expect(allOf(state.lastEvents, "attackRolled")).toHaveLength(2);
    expect(allOf(state.lastEvents, "defenseRolled")).toHaveLength(2);
    expect(allOf(state.lastEvents, "battleDamage")).toHaveLength(2);
    // 两击属于同一个攻击回合，攻防身份只交接一次
    expect(allOf(state.lastEvents, "battleRoundAdvanced")).toHaveLength(1);
  });

  it("动作如潮：只在本场第一次攻击时触发，追加出来的那一击不会再追加", () => {
    let state = resolveRound(banditChiefBattle(20260805));
    expect(state.phase.kind).toBe("battle");

    state = resolveRound(state); // 玩家还手
    state = resolveRound(state); // 头目的第二个攻击回合

    expect(allOf(state.lastEvents, "attackRolled")).toHaveLength(1);
  });

  it("动作如潮：防御卷轴对追加的那一击同样有效", () => {
    /*
      卷轴的作用范围是「一次攻击回合」（GameRule 8.4），两击都在这个回合里。
      只护住前半段的话，一张牌会因为对手的技能凭空缩水一半，而玩家出牌时
      根本没有信息去规避——牌是在看到第一击结果之前就交出去的。
    */
    let state = banditChiefBattle(20260805);
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];

    state = resolveRound(state, { defense: "guard-1" });

    const defenses = allOf(state.lastEvents, "defenseRolled");
    expect(defenses.map((event) => event.flatBonus)).toEqual([3, 3]);
    // 只打了一张，也只消耗一张
    expect(state.players.player1.scrolls).toHaveLength(0);
  });

  it("动作如潮：第一击就打倒玩家时不会再打第二次", () => {
    // 防御归零后攻击总和必定压过防御总和，这一击稳定见血
    const state = banditChiefBattle(20260805, 1);
    state.players.player1.baseDefense = 0;

    const next = resolveRound(state);

    expect(allOf(next.lastEvents, "attackRolled")).toHaveLength(1);
    expect(only(next.lastEvents, "battleEnded").outcome).toBe("playerLost");
  });

  it("凝胶质：生化蛞蝓受到的每一次伤害至多 3 点", () => {
    const state = pveBattle(20260805, "bioSlug", undefined, { attacker: "a" });
    // 攻击拉到远超封顶线，攻防骰再怎么投，这一击都该停在 3
    state.players.player1.baseAttack = 50;

    const next = resolveRound(state);

    expect(only(next.lastEvents, "battleDamage").amount).toBe(3);
  });

  it("凝胶质：只削顶，够不到 3 点的伤害原样落地", () => {
    /*
      逼引擎投出一整条低伤害区间要靠碰种子，读起来全是噪音，理由同下面的重斧。
      钩子接没接上已经由上一条经引擎的用例守住了，这里只验封顶本身的形状。
    */
    const [effects] = enemyEffects("bioSlug");
    const capped = (incoming: number) => {
      let damage = incoming;
      effects.beforeDamage?.({
        incoming,
        reduceDamage: (by: number) => {
          damage = Math.min(damage, Math.max(0, damage - by));
        },
        capDamage: (max: number) => { damage = Math.min(damage, Math.max(0, max)); },
        addBattleLog() {},
      } as unknown as EnemyDamageContext);
      return damage;
    };

    expect([0, 1, 2, 3, 4, 9].map(capped)).toEqual([0, 1, 2, 3, 3, 3]);
  });

  it("凝胶质：卷轴直伤走同一个漏斗，一样被压到 3 点", () => {
    /*
      这正是它挂 beforeDamage 而不是防御侧 damageReduction 的理由：
      直伤不经过攻防差，写在投骰那一层的减免根本拦不到它。
    */
    const state = createInitialGame(20260805);
    state.players.player1.scrolls = [{ instanceId: "dragon-1", kind: "dragonStrike" }];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "bioSlug" }),
    };

    const next = resolveRound(state, { attack: "dragon-1" });

    // 巨龙打击 10 点，减去防御 1 之后仍有 9，凝胶质把它压到 3
    const damages = next.lastEvents.filter((event) => event.type === "battleDamage");
    expect(damages[0].amount).toBe(3);
  });

  it("激怒：玩家本场每用一张卷轴，愤怒的熊攻击 +1", () => {
    for (const [used, expected] of [[0, 0], [1, 1], [3, 3]] as const) {
      const state = resolveRound(
        pveBattle(20260805, "ragingBear", undefined, {
          attacker: "b",
          scrollsUsedA: used,
        }),
      );
      expect(attackBonusOf(state)).toBe(expected);
    }
  });

  it("激怒：本回合刚打出的牌当回合就算数", () => {
    /*
      计数排在效果结算之前，所以玩家在挨打的回合掏防御牌，这一击就已经被激怒。
      慢半拍的话牌面写的因果就断了——用牌的那一下反而安全。
    */
    const state = pveBattle(20260805, "ragingBear", undefined, { attacker: "b" });
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];

    const next = resolveRound(state, { defense: "guard-1" });

    expect(attackBonusOf(next)).toBe(1);
    if (next.phase.kind !== "battle") throw new Error("这一回合不该结束战斗");
    expect(next.phase.battle.scrollsUsedA).toBe(1);
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
    /*
      词条基础只加血，攻防全交给具体词缀。
      血量取自 ELITE_BASE_MODIFIERS 而不是写死数字——这一条守的是「加成叠在
      本体之上」这个结构，不是某一次平衡里的具体数值，调平衡不该让它变红。
    */
    const eliteHpBonus = ELITE_BASE_MODIFIERS
      .filter((modifier) => modifier.type === "maxHp")
      .reduce((sum, modifier) => sum + modifier.value, 0);
    const frenziedAttackBonus = ELITE_AFFIXES.frenzied.modifiers
      .filter((modifier) => modifier.type === "statBonus" && modifier.stat === "attack")
      .reduce((sum, modifier) => sum + modifier.value, 0);
    expect(eliteHpBonus).toBeGreaterThan(0);
    expect(enemyStats("wolf", "frenzied")).toMatchObject({
      name: "狂暴的山狼",
      maxHp: wolf.maxHp + eliteHpBonus,
      attack: wolf.attack + frenziedAttackBonus,
      defense: 1,
    });
  });

  it("生命旺盛的：在公共词条生命加成之外再增加 5 点最大生命", () => {
    const wolf = enemyStats("wolf");
    const sharedHpBonus = ELITE_BASE_MODIFIERS
      .filter((modifier) => modifier.type === "maxHp")
      .reduce((sum, modifier) => sum + modifier.value, 0);

    expect(enemyStats("wolf", "vigorous")).toMatchObject({
      name: "生命旺盛的山狼",
      maxHp: wolf.maxHp + sharedHpBonus + 5,
    });
  });

  it("开战血量走折算后的上限，精英怪才不会按本体血量开打", () => {
    const state = createInitialGame(20260805);
    // 先攻由开局投骰决定，这里要的是"轮到 player1"，不能听天由命
    state.activePlayerId = "player1";
    state.players.player1.position = 10;
    // 对手挪远，免得撞上触发相遇战
    state.players.player2.position = 60;
    // 把这一掷可能落到的六格全铺成精英格，移动骰投几点都会现场抽取精英怪
    for (let id = 11; id <= 16; id += 1) {
      state.map.tiles[id] = {
        id,
        region: "foothill",
        type: "elite",
        label: "测试精英",
      };
    }

    const next = gameReducer(state, { type: "rollMovement" });

    if (next.phase.kind !== "battle") throw new Error("应当进入战斗");
    const { enemyId, enemyAffix } = next.phase.battle;
    expect(enemyTier(enemyId!)).toBe("elite");
    expect(enemyAffix).toBeUndefined();
    expect(next.phase.battle.hpB).toBe(enemyStats(enemyId!, enemyAffix).maxHp);
  });
});
