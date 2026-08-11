import { describe, expect, it } from "vitest";
import { drawableScrollKinds, SCROLLS } from "../content/scrolls";
import { createInitialGame, gameReducer } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState, OwnedScroll } from "../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

const crownCards = (scrolls: readonly OwnedScroll[]) =>
  scrolls.filter((scroll) => scroll.kind === "fateCrownDecree");

/** 戴着王冠的 player1 站上一个战斗格，等着 rollMovement 把他送进战斗 */
function wearingCrown(seed: number): GameState {
  const state = createInitialGame(seed);
  state.players.player1.equipment = [{ instanceId: "crown-1", kind: "fateCrown" }];
  state.activePlayerId = "player1";
  return state;
}

describe("命运王冠", () => {
  it("发的那张牌不进随机卡池", () => {
    // 否则宝箱和战斗奖励会把这张战斗限定牌当普通卷轴发出去
    expect(SCROLLS.fateCrownDecree.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("fateCrownDecree");
    expect(drawableScrollKinds()).toContain("might");
  });

  it("战斗开始时发一张，且标记为临时牌", () => {
    let state = wearingCrown(4242);
    state.players.player1.position = 0;
    // 把移动骰能到的每一格都铺成战斗格，掷出几点都必定开战，不看种子脸色
    for (let id = 1; id <= 6; id += 1) {
      state.map.tiles[id] = {
        id,
        region: "foothill",
        type: "battle",
        label: "测试战斗格",
        enemyId: "slime",
      };
    }
    expect(crownCards(state.players.player1.scrolls)).toHaveLength(0);

    state = gameReducer(state, { type: "rollMovement" });

    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    const granted = crownCards(state.players.player1.scrolls);
    expect(granted).toHaveLength(1);
    expect(granted[0].temporary).toBe(true);
    // 走的是正常的获得事件，界面才能按发牌动画把它亮出来
    expect(
      state.lastEvents.some(
        (event) => event.type === "scrollGranted" && event.instanceId === granted[0].instanceId,
      ),
    ).toBe(true);
  });

  it("没戴王冠就不发牌", () => {
    let state = wearingCrown(4242);
    state.players.player1.equipment = [];
    state.players.player1.position = 0;
    for (let id = 1; id <= 6; id += 1) {
      state.map.tiles[id] = {
        id,
        region: "foothill",
        type: "battle",
        label: "测试战斗格",
        enemyId: "slime",
      };
    }

    state = gameReducer(state, { type: "rollMovement" });

    expect(state.phase.kind).toBe("battle");
    expect(state.players.player1.scrolls).toHaveLength(0);
  });

  it("打出后第一颗骰直接是最高面，其余骰子照常随机", () => {
    let state = createInitialGame(7);
    state.players.player1.scrolls = [
      { instanceId: "crown-card", kind: "fateCrownDecree" },
      { instanceId: "pool-1", kind: "loadedDicePool" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "crown-card" });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(1);
    expect(attack.dice[0]).toBe(attack.sides);
  });

  it("只拉满一颗，不会把满载骰池的三颗一起拉满", () => {
    /*
      这正是不复用 minimumRoll 的原因：minimumRoll 抬的是每一颗骰子的下限。
      不过 8.5 规定每回合只能打一张牌，所以这两张实际上凑不到一起——
      这里直接构造 modifiers 覆盖的场景，守住 maxRollDice 的语义本身。
    */
    let state = createInitialGame(7);
    state.players.player1.scrolls = [{ instanceId: "pool-1", kind: "loadedDicePool" }];
    state.players.player1.equipment = [{ instanceId: "crown-1", kind: "fateCrown" }];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };
    // 手动把王冠牌塞进手里，模拟"战斗开始已发牌"，再打满载骰池
    state.players.player1.scrolls.push({
      instanceId: "crown-card",
      kind: "fateCrownDecree",
      temporary: true,
    });

    state = resolveRound(state, { attack: "pool-1" });

    const attack = only(state.lastEvents, "attackRolled");
    // 这一轮打的是满载骰池，王冠没打出去，三颗骰全随机
    expect(attack.dice).toHaveLength(3);
    expect(attack.dice.every((die) => die <= attack.sides)).toBe(true);
  });

  it("战斗结束时回收，没打出去的临时牌不会留在手上", () => {
    let state = createInitialGame(4242);
    state.players.player1.equipment = [{ instanceId: "crown-1", kind: "fateCrown" }];
    state.players.player1.scrolls = [
      { instanceId: "keep-me", kind: "might" },
      { instanceId: "crown-card", kind: "fateCrownDecree", temporary: true },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 1 }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("battle");
    expect(crownCards(state.players.player1.scrolls)).toHaveLength(0);
    // 常驻手牌不受影响
    expect(state.players.player1.scrolls.map((item) => item.instanceId)).toContain("keep-me");
  });

  it("相遇战败方不能把临时牌当代价交出去", () => {
    /*
      回收必须发生在代价阶段之前。晚一步的话，败方手上还攥着那张战斗限定牌，
      交给赢家就变成了一张凭空多出来的常驻卡。
    */
    let state = createInitialGame(20260805);
    state.players.player1.baseAttack = 99;
    state.players.player2.baseDefense = 0;
    state.players.player2.scrolls = [
      { instanceId: "crown-card", kind: "fateCrownDecree", temporary: true },
    ];
    state.players.player2.equipment = [{ instanceId: "crown-1", kind: "fateCrown" }];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpB: 1,
      }),
    };

    state = resolveRound(state);
    expect(state.phase.kind).toBe("pvpPenalty");

    // 临时牌已经回收，败方手上没有卷轴可交
    expect(state.players.player2.scrolls).toHaveLength(0);

    // 就算硬提交那个 instanceId 也交不出去
    const rejected = gameReducer(state, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "scroll",
      instanceId: "crown-card",
    });
    expect(rejected).toBe(state);
    expect(crownCards(state.players.player1.scrolls)).toHaveLength(0);
  });
});
