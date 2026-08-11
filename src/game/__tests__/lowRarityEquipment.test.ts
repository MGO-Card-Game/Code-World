import { describe, expect, it } from "vitest";
import { startBattle } from "../battle";
import { applyEquipmentBeforeRoll, newRollModifiers } from "../battleRound";
import { drawableScrollKinds, SCROLLS } from "../content/scrolls";
import { createInitialGame } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type { BattleState, GameEvent, GameState, OwnedScroll } from "../types";

/**
 * 一批 N 档装备的行为规格。
 *
 * 放在 __tests__ 而不是 content/equipment 旁边：这些用例跑的是整条结算链
 * （engine → battleRound → resources），不是分类表自身的形状。
 */

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** 一场 PvP，player1 在 a 侧、默认先攻。 */
function pvpBattle(seed: number, overrides: Partial<BattleState> = {}): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({
      kind: "pvp",
      aPlayerId: "player1",
      bPlayerId: "player2",
      ...overrides,
    }),
  };
  return state;
}

/** 双方都打不穿对面：用来把战斗拖到指定回合数。 */
function stalemate(seed: number): GameState {
  const state = pvpBattle(seed);
  for (const player of Object.values(state.players)) {
    player.baseAttack = 0;
    player.baseDefense = 99;
  }
  return state;
}

/**
 * 把双方的骰子都钉死在 4，让伤害成为一个可以逐点断言的定值。
 *
 * 用现成的裂纹骰面卷轴而不是自造探针装备：fixedRoll 本来就是「钉死一颗骰」，
 * 攻防两个时机都能打，比再往 EQUIPMENT 里塞一件测试用卡干净。
 */
function lockedDamageBattle(
  seed: number,
  { baseAttack, hpB = 99 }: { baseAttack: number; hpB?: number },
): GameState {
  const state = pvpBattle(seed, { hpB });
  state.players.player1.baseAttack = baseAttack;
  state.players.player1.scrolls = [
    { instanceId: "lock-a", kind: "crackedDieFaceLock" },
  ];
  state.players.player2.baseDefense = 0;
  state.players.player2.scrolls = [
    { instanceId: "lock-b", kind: "crackedDieFaceLock" },
  ];
  return state;
}

const lockedRound = (state: GameState) =>
  resolveRound(state, { attack: "lock-a", defense: "lock-b" });

describe("磨石短匕", () => {
  it("只把攻击骰的下限抬到 2，防御骰不管", () => {
    const state = pvpBattle(1);
    state.players.player1.equipment = [
      { instanceId: "dagger-1", kind: "whetstoneDagger" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");

    const attack = newRollModifiers();
    applyEquipmentBeforeRoll(state, state.phase.battle, "a", "b", "attack", attack);
    expect(attack.minimumRoll).toBe(2);

    const defense = newRollModifiers();
    applyEquipmentBeforeRoll(state, state.phase.battle, "a", "b", "defense", defense);
    expect(defense.minimumRoll).toBe(1);
  });

  it("戴上之后攻击骰再也掷不出 1，不戴时掷得出", () => {
    const attackDice = (equipped: boolean) => {
      const dice: number[] = [];
      for (let seed = 1; seed <= 60; seed += 1) {
        let state = stalemate(seed);
        if (equipped) {
          state.players.player1.equipment = [
            { instanceId: `dagger-${seed}`, kind: "whetstoneDagger" },
          ];
        }
        state = resolveRound(state);
        dice.push(...only(state.lastEvents, "attackRolled").dice);
      }
      return dice;
    };

    expect(attackDice(true).some((die) => die < 2)).toBe(false);
    // 对照组：同样这批种子，不戴匕首是会掷出 1 的，上一条断言才有意义
    expect(attackDice(false).some((die) => die === 1)).toBe(true);
  });

  it("不会把精准卷轴抬得更高的下限压回 2", () => {
    // 取 max 而不是赋值：卷轴先结算，装备不该把它的成果盖掉
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = stalemate(seed);
      state.players.player1.equipment = [
        { instanceId: `dagger-${seed}`, kind: "whetstoneDagger" },
      ];
      state.players.player1.scrolls = [
        { instanceId: "precision-1", kind: "precision" },
      ];

      state = resolveRound(state, { attack: "precision-1" });

      const attack = only(state.lastEvents, "attackRolled");
      expect(attack.dice.every((die) => die >= 4)).toBe(true);
    }
  });
});

describe("符匠刻刀", () => {
  /*
    手牌全部挑不带 flatBonus 的攻击牌（狂暴=投两次、破阵战鼓=多一颗、精准=抬下限），
    这样事件里的 flatBonus 就只剩刻刀那一份，不必再从合计里反推。
  */
  const knifeBattle = (seed: number) => {
    const state = stalemate(seed);
    state.players.player1.equipment = [
      { instanceId: "knife-1", kind: "sigilCarversKnife" },
    ];
    state.players.player1.scrolls = [
      { instanceId: "frenzy-1", kind: "frenzy" },
      { instanceId: "drum-1", kind: "breachDrum" },
      { instanceId: "precision-1", kind: "precision" },
    ];
    return state;
  };

  it("一张牌都没打时不加值", () => {
    const state = resolveRound(knifeBattle(31));
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(0);
  });

  it("本回合刚打出的牌本回合就算数", () => {
    // countScrollUse 排在装备钩子之前，牌面写的因果不该慢半拍
    const state = resolveRound(knifeBattle(31), { attack: "frenzy-1" });
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(1);
  });

  it("封顶 +2，打三张也不会更多", () => {
    const state = resolveRound(knifeBattle(31), {
      attack: ["frenzy-1", "drum-1", "precision-1"],
    });
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(2);
  });

  it("防守时打出的牌也计入，但只在自己攻击时兑现", () => {
    let state = stalemate(32);
    state.players.player2.equipment = [
      { instanceId: "knife-1", kind: "sigilCarversKnife" },
    ];
    state.players.player2.scrolls = [
      { instanceId: "wall-1", kind: "ironWallOrder" },
    ];

    // 第 1 轮 player2 防守并打牌：加值属于攻击时机，这一轮防御不涨
    state = resolveRound(state, { defense: "wall-1" });
    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(0);

    // 第 2 轮轮到 player2 攻击，上一轮那张牌兑现
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(1);
  });
});

describe("裂口重盾", () => {
  const bulwarkBattle = (seed: number, attack: number) => {
    const state = pvpBattle(seed, { hpB: 99 });
    state.players.player1.baseAttack = attack;
    state.players.player2.baseDefense = 0;
    state.players.player2.equipment = [
      { instanceId: "bulwark-1", kind: "crackedBulwark" },
    ];
    return state;
  };

  it("挨打之后防御骰上限从 8 掉到 7，且暗格不被消耗", () => {
    let state = bulwarkBattle(41, 30);

    // 第 1 轮：这一击落地前盾还是完好的
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(8);
    expect(state.players.player2.equipment[0].battleMemo).toBe(1);

    // 第 2 轮 player2 攻击，第 3 轮才轮到它再防一次
    state = resolveRound(state);
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(7);
    // 读到之后不清空——它要管整场，不是一次性的
    expect(state.players.player2.equipment[0].battleMemo).toBe(1);

    state = resolveRound(state);
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(7);
  });

  it("这一下没挨到就不裂", () => {
    let state = bulwarkBattle(42, 0);
    state.players.player2.baseDefense = 99;

    state = resolveRound(state);

    expect(only(state.lastEvents, "battleDamage").amount).toBe(0);
    expect(state.players.player2.equipment[0].battleMemo).toBeUndefined();
    state = resolveRound(state);
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(8);
  });

  it("战斗结束后裂口复原，下一场重新从 +2 开始", () => {
    // 一击就打死：暗格在这一轮里先被写上，再由 finishBattle 开头的 clearBattleMemos 收走
    let state = bulwarkBattle(43, 30);
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpB = 5;

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("battle");
    const bulwark = () =>
      state.players.player2.equipment.find((item) => item.instanceId === "bulwark-1");
    expect(bulwark()?.battleMemo).toBeUndefined();

    // 新开一场，+2 回来了
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpB: 99,
      }),
    };
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(8);
  });
});

describe("铁匠围裙", () => {
  it("伤害达到 4 点就减 2", () => {
    // 双方骰子都钉在 4，基础防御 0，所以攻防差恰好等于 baseAttack
    let state = lockedDamageBattle(51, { baseAttack: 4 });
    state.players.player2.equipment = [
      { instanceId: "apron-1", kind: "blacksmithsApron" },
    ];

    state = lockedRound(state);

    expect(only(state.lastEvents, "attackRolled").total
      - only(state.lastEvents, "defenseRolled").total).toBe(4);
    expect(only(state.lastEvents, "battleDamage").amount).toBe(2);
  });

  it("差 1 点不到阈值就一点不减", () => {
    let state = lockedDamageBattle(51, { baseAttack: 3 });
    state.players.player2.equipment = [
      { instanceId: "apron-1", kind: "blacksmithsApron" },
    ];

    state = lockedRound(state);

    expect(only(state.lastEvents, "battleDamage").amount).toBe(3);
  });

  it("阈值读的是快照，别的护甲先减掉的部分不算数", () => {
    /*
      磨损铁甲每次减 1。如果围裙读的是实时值，4 点伤害会先被磨到 3、
      再被围裙判为不到阈值——两件一起穿反而比只穿围裙还差。
    */
    let state = lockedDamageBattle(52, { baseAttack: 4 });
    state.players.player2.equipment = [
      { instanceId: "apron-1", kind: "blacksmithsApron" },
      { instanceId: "worn-1", kind: "wornIronArmor" },
    ];

    state = lockedRound(state);

    expect(only(state.lastEvents, "battleDamage").amount).toBe(1);
  });
});

describe("士兵行军靴", () => {
  const marchBattle = (seed: number) => {
    const state = stalemate(seed);
    state.players.player1.equipment = [
      { instanceId: "march-1", kind: "veteransMarchBoots" },
    ];
    return state;
  };

  it("前两回合没有任何加值，第 3 回合起攻防各 +1", () => {
    let state = marchBattle(61);

    // 第 1 轮：player1 攻击
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(0);

    // 第 2 轮：player1 防守
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(0);

    // 第 3 轮：player1 攻击
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(1);

    // 第 4 轮：player1 防守
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(1);
  });

  it("加值只属于穿鞋的那个人", () => {
    let state = marchBattle(62);
    state = resolveRound(state);
    state = resolveRound(state);
    state = resolveRound(state);
    // 第 3 轮 player1 攻、player2 防：对面没穿这双鞋
    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(0);
  });
});

describe("护卫靴", () => {
  /** 一场怪物先攻的 PvE，player1 只防不攻 */
  const guardedBattle = (
    seed: number,
    battle: Partial<BattleState>,
  ): GameState => {
    const state = createInitialGame(seed);
    state.players.player1.equipment = [
      { instanceId: "keeper-1", kind: "gamekeepersBoots" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "slime",
        attacker: "b",
        ...battle,
      }),
    };
    return state;
  };

  it("对普通怪没有任何加成", () => {
    const state = resolveRound(guardedBattle(71, {}));
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);
  });

  it("对精英和首领防御骰上限 +1", () => {
    const elite = resolveRound(guardedBattle(71, { enemyAffix: "honed" }));
    expect(only(elite.lastEvents, "defenseRolled").sides).toBe(7);

    const boss = resolveRound(
      guardedBattle(71, { kind: "boss", enemyId: "dragon" }),
    );
    expect(only(boss.lastEvents, "defenseRolled").sides).toBe(7);
  });

  it("不碰攻击骰", () => {
    const state = resolveRound(
      guardedBattle(72, { enemyAffix: "honed", attacker: "a" }),
    );
    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
  });
});

describe("破损护腕", () => {
  it("每打出一张牌损失 1 点生命", () => {
    let state = stalemate(81);
    state.players.player1.equipment = [
      { instanceId: "bracers-1", kind: "frayedBracers" },
    ];
    state.players.player1.scrolls = [
      { instanceId: "might-1", kind: "might" },
      { instanceId: "frenzy-1", kind: "frenzy" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { attack: ["might-1", "frenzy-1"] });

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore - 2);
  });

  it("两件叠在两个饰品槽里，代价也翻倍", () => {
    // 饰品是唯一能叠的分类，代价类装备叠起来越来越疼是它该有的样子
    let state = stalemate(82);
    state.players.player1.equipment = [
      { instanceId: "bracers-1", kind: "frayedBracers" },
      { instanceId: "bracers-2", kind: "frayedBracers" },
    ];
    state.players.player1.scrolls = [{ instanceId: "might-1", kind: "might" }];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { attack: "might-1" });

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore - 2);
  });

  it("一张牌都不打就不掉血", () => {
    let state = stalemate(83);
    state.players.player1.equipment = [
      { instanceId: "bracers-1", kind: "frayedBracers" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state);

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore);
  });
});

describe("拾荒者背袋", () => {
  const satchelCards = (scrolls: readonly OwnedScroll[]) =>
    scrolls.filter((scroll) => scroll.kind === "scavengersSatchelGuard");

  it("发的那张牌不进随机卡池", () => {
    // 否则宝箱和战斗奖励会把这张战斗限定牌当普通卷轴发出去，变成永久卡
    expect(SCROLLS.scavengersSatchelGuard.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("scavengersSatchelGuard");
  });

  it("战斗开始时发一张，且标记为临时牌", () => {
    const state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "satchel-1", kind: "scavengersSatchel" },
    ];
    expect(satchelCards(state.players.player1.scrolls)).toHaveLength(0);

    startBattle(state, "pve", "player1", "slime");

    const granted = satchelCards(state.players.player1.scrolls);
    expect(granted).toHaveLength(1);
    expect(granted[0].temporary).toBe(true);
  });

  it("打出后本次防御 +2，且只能在防守时机打", () => {
    expect(SCROLLS.scavengersSatchelGuard.timings).toEqual(["beforeDefenseRoll"]);

    let state = stalemate(91);
    state.players.player2.scrolls = [
      { instanceId: "satchel-guard-1", kind: "scavengersSatchelGuard", temporary: true },
    ];

    state = resolveRound(state, { defense: "satchel-guard-1" });

    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(2);
  });
});
