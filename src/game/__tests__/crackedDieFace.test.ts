import { describe, expect, it } from "vitest";
import { startBattle } from "../battle";
import { EQUIPMENT } from "../content/equipment";
import { drawableScrollKinds, SCROLLS } from "../content/scrolls";
import { createInitialGame } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState, OwnedScroll } from "../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

const lockCards = (scrolls: readonly OwnedScroll[]) =>
  scrolls.filter((scroll) => scroll.kind === "crackedDieFaceLock");

/** 一场 a 侧先攻的 PvP，攻击方手上有指定的牌 */
function stagedWithHand(
  seed: number,
  hand: readonly { instanceId: string; kind: OwnedScroll["kind"] }[],
): GameState {
  const state = createInitialGame(seed);
  state.players.player1.scrolls = hand.map((card) => ({ ...card }));
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("裂纹骰面", () => {
  it("是饰品 N，本体不带任何数值修正", () => {
    expect(EQUIPMENT.crackedDieFace.category).toBe("accessory");
    expect(EQUIPMENT.crackedDieFace.rarity).toBe("N");
    expect(EQUIPMENT.crackedDieFace.modifiers).toEqual([]);
  });

  it("发的那张牌不进随机卡池", () => {
    // 否则宝箱和战斗奖励会把这张战斗限定牌当普通卷轴发出去
    expect(SCROLLS.crackedDieFaceLock.drawable).toBe(false);
    expect(drawableScrollKinds()).not.toContain("crackedDieFaceLock");
  });

  it("战斗开始时发一张，且标记为临时牌", () => {
    const state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "face-1", kind: "crackedDieFace" },
    ];
    expect(lockCards(state.players.player1.scrolls)).toHaveLength(0);

    startBattle(state, "pve", "player1", "slime");

    const granted = lockCards(state.players.player1.scrolls);
    expect(granted).toHaveLength(1);
    expect(granted[0].temporary).toBe(true);
  });

  it("打出后第一颗骰恒为 4，与种子无关", () => {
    for (const seed of [1, 7, 4242, 20260805]) {
      let state = stagedWithHand(seed, [
        { instanceId: "lock-1", kind: "crackedDieFaceLock" },
      ]);

      state = resolveRound(state, { attack: "lock-1" });

      expect(only(state.lastEvents, "attackRolled").dice).toEqual([4]);
    }
  });

  it("只钉一颗，满载骰池的另外两颗照常随机", () => {
    let state = stagedWithHand(7, [
      { instanceId: "lock-1", kind: "crackedDieFaceLock" },
      { instanceId: "pool-1", kind: "loadedDicePool" },
    ]);

    state = resolveRound(state, { attack: ["lock-1", "pool-1"] });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(3);
    expect(attack.dice[0]).toBe(4);
    // 前置条件：后两颗至少有一颗不是 4，否则这条测不出"只钉一颗"
    expect(attack.dice.slice(1).some((die) => die !== 4)).toBe(true);
  });

  it("钉死就是钉死，铁壁令抬不动它，也压不住高骰面", () => {
    /*
      这张牌的代价是同时放弃上下两头。和 minimumRoll 同场时它仍然说了算，
      否则「改为 4」就退化成了一张只赚不亏的牌。
    */
    let state = stagedWithHand(7, [
      { instanceId: "lock-1", kind: "crackedDieFaceLock" },
      { instanceId: "fate-1", kind: "fate" },
    ]);

    state = resolveRound(state, { attack: ["lock-1", "fate-1"] });

    const attack = only(state.lastEvents, "attackRolled");
    // D20 换了骰面，但被钉住的那颗还是 4
    expect(attack.sides).toBe(20);
    expect(attack.dice).toEqual([4]);
  });

  it("和命运王冠同场时各占一颗，拉满的那颗优先", () => {
    let state = stagedWithHand(7, [
      { instanceId: "lock-1", kind: "crackedDieFaceLock" },
      { instanceId: "crown-1", kind: "fateCrownDecree" },
      { instanceId: "pool-1", kind: "loadedDicePool" },
    ]);

    state = resolveRound(state, { attack: ["lock-1", "crown-1", "pool-1"] });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice[0]).toBe(attack.sides);
    expect(attack.dice[1]).toBe(4);
  });

  it("骰面比 4 还小时钉到骰面上限，不会掷出不存在的点数", () => {
    let state = stagedWithHand(7, [
      { instanceId: "lock-1", kind: "crackedDieFaceLock" },
    ]);
    // 裂甲战斧每件 -1 防御骰面，叠三件把防御骰压到 D3
    state.players.player2.equipment = [
      { instanceId: "axe-1", kind: "rendingAxe" },
      { instanceId: "axe-2", kind: "rendingAxe" },
      { instanceId: "axe-3", kind: "rendingAxe" },
    ];
    state.players.player2.scrolls = [
      { instanceId: "lock-2", kind: "crackedDieFaceLock" },
    ];

    state = resolveRound(state, { attack: "lock-1", defense: "lock-2" });

    const defense = only(state.lastEvents, "defenseRolled");
    expect(defense.sides).toBeLessThan(4);
    expect(defense.dice).toEqual([defense.sides]);
  });

  it("战斗结束时回收，没打出去的临时牌不会留在手上", () => {
    let state = createInitialGame(4242);
    state.players.player1.equipment = [
      { instanceId: "face-1", kind: "crackedDieFace" },
    ];
    state.players.player1.baseAttack = 99;
    startBattle(state, "pve", "player1", "slime");
    if (state.phase.kind !== "battle") throw new Error("应该已经进入战斗");
    state.phase.battle.attacker = "a";
    expect(lockCards(state.players.player1.scrolls)).toHaveLength(1);

    state = resolveRound(state);

    expect(state.phase.kind).not.toBe("battle");
    expect(lockCards(state.players.player1.scrolls)).toHaveLength(0);
  });
});
