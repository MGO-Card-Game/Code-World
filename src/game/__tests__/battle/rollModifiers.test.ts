import { describe, expect, it } from "vitest";
import { SCROLLS, type ScrollKind } from "../../content/scrolls";
import { createInitialGame, gameReducer } from "../../engine";
import { makeBattle, resolveRound } from "../../testSupport";
import type { BattleState, GameEvent, GameState } from "../../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** 所有排列 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map((tail) => [item, ...tail]);
  });
}

/** 攻击方手上有这些牌的一场 PvP，种子固定 */
function stagedWithHand(hand: readonly { instanceId: string; kind: ScrollKind }[]): GameState {
  const state = createInitialGame(20260805);
  state.players.player1.scrolls = hand.map((card) => ({ ...card }));
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("一回合多张卷轴", () => {
  it("加值、骰数、骰面可以同时生效", () => {
    let state = stagedWithHand([
      { instanceId: "might-1", kind: "might" },
      { instanceId: "fate-1", kind: "fate" },
      { instanceId: "pool-1", kind: "loadedDicePool" },
    ]);

    state = resolveRound(state, { attack: ["might-1", "fate-1", "pool-1"] });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.sides).toBe(20);      // D20 换骰面
    expect(attack.dice).toHaveLength(3); // 满载骰池 +2 颗
    expect(attack.flatBonus).toBe(3);    // 力量 +3
    // 三张牌全部消耗
    expect(state.players.player1.scrolls).toHaveLength(0);
  });

  it("换骰面的牌撞车时取最大，不看谁先提交", () => {
    /*
      这是唯一一个原本会受顺序影响的字段。改成取最大之后，
      "谁生效"由数值决定而不是提交顺序，也就不需要给卡牌配优先级。
    */
    const hand = [
      { instanceId: "fate-1", kind: "fate" as ScrollKind },
      { instanceId: "fate-2", kind: "fate" as ScrollKind },
    ];
    for (const order of permutations(["fate-1", "fate-2"])) {
      let state = stagedWithHand(hand);
      state = resolveRound(state, { attack: order });
      // 两张 D20 不会叠成 D40
      expect(only(state.lastEvents, "attackRolled").sides).toBe(20);
    }
  });

  it("累加类效果换任何顺序结果都一样", () => {
    // 加一张新卡后这条挂了，说明它引入了顺序依赖，需要重新设计合并规则
    const hand = [
      { instanceId: "might-1", kind: "might" as ScrollKind },
      { instanceId: "fate-1", kind: "fate" as ScrollKind },
      { instanceId: "pool-1", kind: "loadedDicePool" as ScrollKind },
    ];
    const ids = hand.map((card) => card.instanceId);

    const results = permutations(ids).map((order) => {
      let state = stagedWithHand(hand);
      state = resolveRound(state, { attack: order });
      const attack = only(state.lastEvents, "attackRolled");
      return {
        sides: attack.sides,
        diceCount: attack.dice.length,
        flatBonus: attack.flatBonus,
        total: attack.total,
      };
    });

    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("防守方同样可以叠加", () => {
    let state = stagedWithHand([]);
    state.players.player2.scrolls = [
      { instanceId: "guard-1", kind: "guard" },
      { instanceId: "wall-1", kind: "ironWallOrder" },
    ];

    state = resolveRound(state, { defense: ["guard-1", "wall-1"] });

    const defense = only(state.lastEvents, "defenseRolled");
    expect(defense.flatBonus).toBe(3);
    expect(defense.dice.every((die) => die >= 3)).toBe(true);
    expect(state.players.player2.scrolls).toHaveLength(0);
  });

  it("中途把对手打倒时，剩下的牌照样算已消耗", () => {
    // 打出去就是打出去了，不因为对面先死就退回手里
    let state = stagedWithHand([
      { instanceId: "dragon-1", kind: "dragonStrike" },
      { instanceId: "might-1", kind: "might" },
    ]);
    state.players.player2.baseDefense = 0;
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpB = 3;

    state = resolveRound(state, { attack: ["dragon-1", "might-1"] });

    expect(only(state.lastEvents, "battleEnded").winnerSide).toBe("a");
    expect(state.players.player1.scrolls).toHaveLength(0);
    // 战斗在掷骰前就结束了
    expect(state.lastEvents.filter((event) => event.type === "attackRolled")).toHaveLength(0);
  });

  it("同一张牌不能提交两次", () => {
    const state = stagedWithHand([{ instanceId: "might-1", kind: "might" }]);

    const rejected = gameReducer(state, {
      type: "submitScrollChoice",
      side: "a",
      instanceIds: ["might-1", "might-1"],
    });

    expect(rejected).toBe(state);
  });

  it("一组牌里只要有一张不合法，整次提交都拒绝", () => {
    const state = stagedWithHand([{ instanceId: "might-1", kind: "might" }]);

    const rejected = gameReducer(state, {
      type: "submitScrollChoice",
      side: "a",
      instanceIds: ["might-1", "ghost"],
    });

    expect(rejected).toBe(state);
    // 合法的那张也不该被偷偷记下来
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    expect(state.phase.battle.choiceA.status).toBe("pending");
  });

  it("每种卷轴的效果类型都在已知的合并规则之内", () => {
    /*
      新增效果类型时，必须先想清楚它多张叠加怎么合并，再来这里登记。
      漏登记会在这里失败，而不是等到数值算错才被发现。
      commutative：换顺序结果不变；sequential：带副作用，按提交顺序结算。
      */
    const COMMUTATIVE = [
      "flatBonus", "dieSides", "dieSidesBonus", "extraDice", "rollTwice", "minimumRoll", "maxRoll",
      "fixedRoll", "damageReduction", "damageCap", "postRoundSelfHpLoss",
      "skipNextAttack", "penalizeNextAttackDieSides",
    ];
    const SEQUENTIAL = [
      "directDamage", "heal", "forfeitMovement", "chooseMovement", "teleport",
      "teleportAnywhere", "advanceTiles", "returnToCamp", "returnToPreviousPosition",
      "custom", "selfHpLoss", "mutualDirectDamage",
      "targetPlayer",
    ];
    /*
      地图独占型的那几种（chooseMovement / teleport / teleportAnywhere /
      advanceTiles / targetPlayer）压根不会一回合打出多张：它们各自独占整张牌，
      而这条规矩由 content/scrolls/category.test.ts 守着，不是靠这里的注释。
    */

    for (const kind of Object.keys(SCROLLS) as ScrollKind[]) {
      for (const effect of SCROLLS[kind].effects) {
        expect([...COMMUTATIVE, ...SEQUENTIAL]).toContain(effect.type);
      }
    }
  });
});

describe("斩首命令", () => {
  /** 攻击方 player1 手上只有一张斩首命令的一场战斗 */
  function stagedAgainst(enemy: Partial<BattleState>): GameState {
    const state = createInitialGame(20260805);
    state.players.player1.scrolls = [
      { instanceId: "order-1", kind: "decapitationOrder" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", ...enemy }),
    };
    return state;
  }

  it("对精英、词条怪和首领追加 3 点伤害", () => {
    const strongEnemies: Partial<BattleState>[] = [
      { kind: "boss", enemyId: "dragon" },
      { enemyId: "razorbackAlpha" },                    // 独立精英怪
      { enemyId: "slime", enemyAffix: "frenzied" },     // 带词条的漫游怪
    ];

    for (const enemy of strongEnemies) {
      let state = stagedAgainst(enemy);
      state = resolveRound(state, { attack: "order-1" });

      const attack = only(state.lastEvents, "attackRolled");
      const defense = only(state.lastEvents, "defenseRolled");
      expect(only(state.lastEvents, "battleDamage").amount).toBe(
        Math.max(0, attack.total - defense.total) + 3,
      );
      expect(state.players.player1.scrolls).toHaveLength(0);
    }
  });

  it("对普通怪和敌方玩家根本打不出，不会被白白交掉", () => {
    const weakTargets: Partial<BattleState>[] = [
      { enemyId: "slime" },                             // 无词条的漫游怪
      { kind: "pvp", bPlayerId: "player2" },
    ];

    for (const target of weakTargets) {
      const state = stagedAgainst(target);
      expect(gameReducer(state, {
        type: "submitScrollChoice",
        side: "a",
        instanceIds: ["order-1"],
      })).toBe(state);
      // 提交被拒，牌留在手上
      expect(state.players.player1.scrolls).toHaveLength(1);
    }
  });
});
