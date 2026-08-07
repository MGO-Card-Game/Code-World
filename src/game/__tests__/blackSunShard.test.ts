import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "../content/equipment";
import { createInitialGame, gameReducer } from "../engine";
import { getDieSidesBonus } from "../selectors";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState } from "../types";

function eventsOf<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = eventsOf(events, type);
  expect(found).toHaveLength(1);
  return found[0];
}

/** 一场 a 侧先攻的 PvP，player1 戴着碎片 */
function shardBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.players.player1.equipment = [
    { instanceId: "shard-1", kind: "blackSunShard" },
  ];
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("黑日碎片", () => {
  it("是饰品 SR，三种骰子上限各 +1", () => {
    expect(EQUIPMENT.blackSunShard.category).toBe("accessory");
    expect(EQUIPMENT.blackSunShard.rarity).toBe("SR");

    const state = createInitialGame(1);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "shard-1", kind: "blackSunShard" }];
    expect(getDieSidesBonus(player, "attack")).toBe(1);
    expect(getDieSidesBonus(player, "defense")).toBe(1);
    expect(getDieSidesBonus(player, "movement")).toBe(1);
  });

  it("战斗里每打出一张牌就损失 1 点生命", () => {
    let state = shardBattle(20260805);
    state.players.player1.scrolls = [
      { instanceId: "might-1", kind: "might" },
      { instanceId: "pool-1", kind: "loadedDicePool" },
    ];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { attack: ["might-1", "pool-1"] });

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    // 两张牌各扣 1 点；对手打不到自己（本轮自己是攻击方）
    expect(state.phase.battle.hpA).toBe(hpBefore - 2);
    expect(only(state.lastEvents, "attackRolled").sides).toBe(7);
  });

  it("一张牌都不打就不掉血", () => {
    let state = shardBattle(20260805);
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state);

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore);
  });

  it("防守时打牌一样收代价", () => {
    let state = shardBattle(20260805);
    // 碎片在 a 侧，让 b 侧先攻，a 侧就成了防守方
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "b";
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];
    state.players.player2.baseAttack = 0;
    state.players.player1.baseDefense = 99;
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { defense: "guard-1" });

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore - 1);
  });

  it("代价可以在战斗里把自己扣倒，对手直接获胜", () => {
    // 这是这张卡的全部风险所在：残血时每打一张牌都是在拿命换
    let state = shardBattle(20260805);
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "b";
    state.phase.battle.hpA = 1;
    state.players.player2.baseAttack = 0;
    state.players.player1.baseDefense = 99;

    state = resolveRound(state, { defense: "guard-1" });

    expect(only(state.lastEvents, "battleEnded").winnerSide).toBe("b");
    // 掷骰根本没发生，自损在那之前就结束了战斗
    expect(eventsOf(state.lastEvents, "attackRolled")).toHaveLength(0);
  });

  it("牌先把对手打倒时不再收代价，赢下来的这一场没有「之后」", () => {
    let state = shardBattle(20260805);
    state.players.player1.scrolls = [{ instanceId: "dragon-1", kind: "dragonStrike" }];
    state.players.player2.baseDefense = 0;
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpA = 1;
    state.phase.battle.hpB = 1;

    state = resolveRound(state, { attack: "dragon-1" });

    expect(only(state.lastEvents, "battleEnded").winnerSide).toBe("a");
    // 只有对手挨了一下，自己一点血没掉
    expect(eventsOf(state.lastEvents, "battleDamage").map((event) => event.targetSide))
      .toEqual(["b"]);
  });

  it("自损不算受到伤害，灰铁胸甲不会白吃一次充能", () => {
    /*
      走伤害管线的话，第一张牌的自损就会消耗掉胸甲的减免，之后真挨打时反而没得减。
      两件护甲让高代价装备变安全，正好把它的设计意图倒过来。
    */
    let state = shardBattle(20260805);
    state.players.player1.equipment.push({
      instanceId: "cuirass-1",
      kind: "ashenIronCuirass",
    });
    state.players.player1.scrolls = [{ instanceId: "guard-1", kind: "guard" }];
    // b 侧先攻，a 侧防守：同一轮里先付代价，再真的挨一下
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.attacker = "b";
    state.players.player2.baseAttack = 10;
    state.players.player1.baseDefense = 0;
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { defense: "guard-1" });

    const hit = eventsOf(state.lastEvents, "battleDamage").at(-1)!;
    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    // 碎片扣 1，攻击照常落地——胸甲的减免留给了这一击，不是被自损吃掉
    expect(state.phase.battle.hpA).toBe(hpBefore - 1 - hit.amount);
    expect(
      state.phase.battle.log.some((line) => line.includes("灰铁胸甲")),
    ).toBe(true);
  });

  it("地图上用疗牌一样收代价，但至少保留 1 点生命", () => {
    let state = createInitialGame(4242);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "shard-1", kind: "blackSunShard" }];
    player.scrolls = [{ instanceId: "bandage-1", kind: "firstAidBandage" }];
    player.hp = 1;
    state.activePlayerId = "player1";
    state.phase = { kind: "awaitingRoll" };

    state = gameReducer(state, { type: "useMapScroll", instanceId: "bandage-1" });

    // 绷带先回 3 点，碎片再扣 1。代价排在效果之后，残血时才不会被扣血下限白嫖掉
    expect(state.players.player1.hp).toBe(1 + 3 - 1);
    expect(
      eventsOf(state.lastEvents, "playerHpChanged").some(
        (event) => event.reason === "equipment" && event.to < event.from,
      ),
    ).toBe(true);
  });

  it("地图上的代价扣不破 1 点生命", () => {
    // 地图阶段没有"倒下"这个状态，山路落石也是同一个约定
    let state = createInitialGame(4242);
    const player = state.players.player1;
    player.equipment = [{ instanceId: "shard-1", kind: "blackSunShard" }];
    player.scrolls = [{ instanceId: "bandage-1", kind: "firstAidBandage" }];
    player.maxHp = 1;
    player.hp = 0;
    state.activePlayerId = "player1";
    state.phase = { kind: "awaitingRoll" };

    state = gameReducer(state, { type: "useMapScroll", instanceId: "bandage-1" });

    expect(state.players.player1.hp).toBe(1);
  });

  it("没戴碎片时打牌不掉血", () => {
    let state = shardBattle(20260805);
    state.players.player1.equipment = [];
    state.players.player1.scrolls = [{ instanceId: "might-1", kind: "might" }];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    const hpBefore = state.phase.battle.hpA;

    state = resolveRound(state, { attack: "might-1" });

    if (state.phase.kind !== "battle") throw new Error("战斗不该结束");
    expect(state.phase.battle.hpA).toBe(hpBefore);
  });
});
