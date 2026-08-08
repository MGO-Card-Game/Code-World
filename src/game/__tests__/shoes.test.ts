import { describe, expect, it } from "vitest";
import { startBattle } from "../battle";
import { EQUIPMENT } from "../content/equipment";
import { drawableScrollKinds, SCROLLS, scrollCategory } from "../content/scrolls";
import { createInitialGame } from "../engine";
import { getDieSidesBonus } from "../selectors";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState, OwnedScroll } from "../types";

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

/** 谁也打不死谁的 PvP 战斗，用来观察跨回合效果。 */
function stalemateBattle(seed: number): GameState {
  const state = pvpBattle(seed);
  for (const player of Object.values(state.players)) {
    player.baseAttack = 0;
    player.baseDefense = 99;
  }
  return state;
}

describe("疾风绑腿", () => {
  it("是鞋具 N，移动骰上限 +1、生命上限 +2，纯 modifier 无 effects", () => {
    expect(EQUIPMENT.windboundWraps.category).toBe("shoes");
    expect(EQUIPMENT.windboundWraps.rarity).toBe("N");
    expect(EQUIPMENT.windboundWraps.modifiers).toEqual([
      { type: "dieSides", die: "movement", value: 1 },
      { type: "maxHp", value: 2 },
    ]);
  });
});

describe("猎踪靴", () => {
  it("移动骰上限 +2，但防御骰上限 -1，走普通 modifier", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "hound-1", kind: "houndstepBoots" }];

    expect(getDieSidesBonus(player, "movement")).toBe(2);
    expect(getDieSidesBonus(player, "defense")).toBe(-1);
    expect(getDieSidesBonus(player, "attack")).toBe(0);
  });
});

describe("逃亡者短靴", () => {
  it("移动骰上限 +1 走普通 modifier", () => {
    expect(EQUIPMENT.runnersBoots.modifiers).toEqual([
      { type: "dieSides", die: "movement", value: 1 },
    ]);
  });

  it("本场战斗第一次结算己方防御骰时，防御骰上限额外 +1", () => {
    let state = stalemateBattle(20260805);
    state.players.player2.equipment = [
      { instanceId: "boots-1", kind: "runnersBoots" },
    ];

    // 第 1 轮：a 攻击，b（穿靴子的一方）防守，应当抬高一级
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(7);

    // 第 2 轮换 b 攻击，靴子不管这一次
    state = resolveRound(state);

    // 第 3 轮 b 第二次防守，暗格已经用掉，不再触发
    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);
  });

  it("不影响攻击骰", () => {
    let state = stalemateBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "runnersBoots" },
    ];

    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(6);
  });
});

describe("迅雷战靴", () => {
  it("移动骰上限 +1，攻击骰上限 +1，走普通 modifier", () => {
    expect(EQUIPMENT.stormstepBoots.modifiers).toEqual([
      { type: "dieSides", die: "movement", value: 1 },
      { type: "dieSides", die: "attack", value: 1 },
    ]);
  });

  it("本场战斗第一次由自己发起攻击时，额外投 1 个攻击骰", () => {
    let state = stalemateBattle(20260805);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "stormstepBoots" },
    ];

    // a 先攻，第 1 轮就是自己第一次出手
    state = resolveRound(state);
    const first = only(state.lastEvents, "attackRolled");
    expect(first.sides).toBe(7);
    expect(first.dice).toHaveLength(2);

    // 第 2 轮换对手攻击，第 3 轮才是自己的第二次攻击——不再多投
    state = resolveRound(state);
    state = resolveRound(state);
    const second = only(state.lastEvents, "attackRolled");
    expect(second.dice).toHaveLength(1);
  });

  it("自己是后攻方时，第一轮只防守，不会误触发攻击加值", () => {
    let state = stalemateBattle(20260805);
    state.players.player2.equipment = [
      { instanceId: "boots-2", kind: "stormstepBoots" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "a";

    state = resolveRound(state);
    expect(only(state.lastEvents, "defenseRolled").sides).toBe(6);

    // 第 2 轮才是 b 第一次攻击，此时轮次已经是 2，不满足「本场第一次」
    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").dice).toHaveLength(1);
  });
});

describe("逐日靴", () => {
  it("是鞋具 PR，移动骰上限 +2 走普通 modifier", () => {
    expect(EQUIPMENT.sunchaserBoots.category).toBe("shoes");
    expect(EQUIPMENT.sunchaserBoots.rarity).toBe("PR");
    expect(EQUIPMENT.sunchaserBoots.modifiers).toEqual([
      { type: "dieSides", die: "movement", value: 2 },
    ]);
  });

  it("发的是攻防通用牌，且不进随机卡池", () => {
    expect(SCROLLS.sunchaserBootsBoost.timings).toEqual([
      "beforeAttackRoll",
      "beforeDefenseRoll",
    ]);
    expect(scrollCategory(SCROLLS.sunchaserBootsBoost)).toBe("universal");
    expect(SCROLLS.sunchaserBootsBoost.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("sunchaserBootsBoost");
  });

  it("战斗开始时发一张，且标记为临时牌", () => {
    const state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "sunchaserBoots" },
    ];
    startBattle(state, "pvp", "player1", undefined, "player2");
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");

    const granted = state.players.player1.scrolls.filter(
      (scroll: OwnedScroll) => scroll.kind === "sunchaserBootsBoost",
    );
    expect(granted).toHaveLength(1);
    expect(granted[0].temporary).toBe(true);
  });

  it("打出后本次攻击或防御 +2，攻防都能用", () => {
    let state = stalemateBattle(7);
    state.players.player1.equipment = [
      { instanceId: "boots-1", kind: "sunchaserBoots" },
    ];
    state.players.player1.scrolls = [
      { instanceId: "boost-1", kind: "sunchaserBootsBoost", temporary: true },
    ];

    state = resolveRound(state, { attack: "boost-1" });
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(2);

    let defenseState = stalemateBattle(7);
    defenseState.players.player2.equipment = [
      { instanceId: "boots-2", kind: "sunchaserBoots" },
    ];
    defenseState.players.player2.scrolls = [
      { instanceId: "boost-2", kind: "sunchaserBootsBoost", temporary: true },
    ];

    defenseState = resolveRound(defenseState, { defense: "boost-2" });
    expect(only(defenseState.lastEvents, "defenseRolled").flatBonus).toBe(2);
  });
});
