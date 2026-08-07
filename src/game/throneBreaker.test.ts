import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "./content/equipment";
import { drawableScrollKinds, SCROLLS, scrollCategory } from "./content/scrolls";
import { createInitialGame, gameReducer } from "./engine";
import { makeBattle, resolveRound } from "./testSupport";
import type { GameEvent, GameState, OwnedScroll } from "./types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

const strikeCards = (scrolls: readonly OwnedScroll[]) =>
  scrolls.filter((scroll) => scroll.kind === "throneBreakerStrike");

/** 扛着王座破坏者的 player1 站在起点，等 rollMovement 把他送进战斗 */
function wieldingBreaker(seed: number): GameState {
  const state = createInitialGame(seed);
  state.players.player1.equipment = [{ instanceId: "breaker-1", kind: "throneBreaker" }];
  state.players.player1.position = 0;
  state.activePlayerId = "player1";
  // 把移动骰能到的每一格都铺成战斗格，掷出几点都必定开战，不看种子脸色
  for (let id = 1; id <= 9; id += 1) {
    state.map.tiles[id] = {
      id,
      region: "foothill",
      type: "battle",
      label: "测试战斗格",
      enemyId: "slime",
    };
  }
  return state;
}

describe("王座破坏者", () => {
  it("是武器 PR，攻击骰上限 +3 走普通 modifier", () => {
    expect(EQUIPMENT.throneBreaker.category).toBe("weapon");
    expect(EQUIPMENT.throneBreaker.rarity).toBe("PR");
    expect(EQUIPMENT.throneBreaker.modifiers).toEqual([
      { type: "dieSides", die: "attack", value: 3 },
    ]);
  });

  it("发的是攻击牌，且不进随机卡池", () => {
    // 只有攻击时机——这是它和命运王冠（攻防通用）唯一的差别
    expect(SCROLLS.throneBreakerStrike.timings).toEqual(["beforeAttackRoll"]);
    expect(scrollCategory(SCROLLS.throneBreakerStrike)).toBe("attack");
    // 否则宝箱和战斗奖励会把这张战斗限定牌当普通卷轴发出去
    expect(SCROLLS.throneBreakerStrike.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("throneBreakerStrike");
  });

  it("战斗开始时发一张，且标记为临时牌", () => {
    let state = wieldingBreaker(4242);
    expect(strikeCards(state.players.player1.scrolls)).toHaveLength(0);

    state = gameReducer(state, { type: "rollMovement" });

    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    const granted = strikeCards(state.players.player1.scrolls);
    expect(granted).toHaveLength(1);
    expect(granted[0].temporary).toBe(true);
  });

  it("打出后本次攻击投三颗骰子，点数相加", () => {
    let state = createInitialGame(7);
    state.players.player1.equipment = [
      { instanceId: "breaker-1", kind: "throneBreaker" },
    ];
    state.players.player1.scrolls = [
      { instanceId: "strike-1", kind: "throneBreakerStrike", temporary: true },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "strike-1" });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(3);
    // 骰面 6 + 3 来自武器本体；总和就是三颗之和，没有额外加值
    expect(attack.sides).toBe(9);
    expect(attack.dice.reduce((sum, die) => sum + die, 0)).toBe(attack.die);
    expect(attack.total).toBe(attack.base + attack.die);
  });

  it("防守时打不出来，只能在攻击时机使用", () => {
    let state = createInitialGame(7);
    state.players.player2.equipment = [
      { instanceId: "breaker-2", kind: "throneBreaker" },
    ];
    state.players.player2.scrolls = [
      { instanceId: "strike-2", kind: "throneBreakerStrike", temporary: true },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    // player2 是本轮防守方，硬提交这张攻击牌应当被拒
    const rejected = gameReducer(state, {
      type: "submitScrollChoice",
      side: "b",
      instanceIds: ["strike-2"],
    });
    expect(rejected).toBe(state);

    // 对照：同一张牌在自己攻击的那一轮就提交得上，上面拒的是时机而不是别的
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "b";
    const accepted = gameReducer(state, {
      type: "submitScrollChoice",
      side: "b",
      instanceIds: ["strike-2"],
    });
    expect(accepted).not.toBe(state);
  });

  it("一场只发一张，打掉就没了", () => {
    let state = wieldingBreaker(4242);
    state = gameReducer(state, { type: "rollMovement" });
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    const granted = strikeCards(state.players.player1.scrolls);
    expect(granted).toHaveLength(1);

    // 攻击方是谁取决于先攻骰，先把它掰成玩家这一侧
    state.phase.battle.attacker = "a";
    state.phase.battle.hpB = 99;
    state = resolveRound(state, { attack: granted[0].instanceId });

    expect(only(state.lastEvents, "attackRolled").dice).toHaveLength(3);
    expect(strikeCards(state.players.player1.scrolls)).toHaveLength(0);
  });
});
