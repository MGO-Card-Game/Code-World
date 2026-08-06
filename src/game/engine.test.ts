import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "./engine";
import {
  makeBattle,
  PLAYTHROUGH_CAP,
  PLAYTHROUGH_SEED,
  resolveRound,
} from "./testSupport";
import { EQUIPMENT_SLOT_LIMITS, equipmentCategory } from "./content/equipment";
import type { GameState } from "./types";

function advanceAutomatically(state: GameState) {
  switch (state.phase.kind) {
    case "awaitingRoll":
      return gameReducer(state, { type: "rollMovement" });
    case "turnComplete":
      return gameReducer(state, { type: "endTurn" });
    case "battle": {
      const battle = state.phase.battle;
      const attackerId = battle.attacker === "a" ? battle.aPlayerId : battle.bPlayerId;
      const defenderId = battle.attacker === "a" ? battle.bPlayerId : battle.aPlayerId;
      const attackScrollId = attackerId
        ? state.players[attackerId].scrolls.find((item) => item.kind === "might")?.instanceId
        : undefined;
      const defenseScrollId = defenderId
        ? state.players[defenderId].scrolls.find((item) => item.kind === "guard")?.instanceId
        : undefined;
      return resolveRound(state, { attack: attackScrollId, defense: defenseScrollId });
    }
    case "pvpPenalty": {
      const loser = state.players[state.phase.penalty.loserId];
      const scroll = loser.scrolls[0];
      if (scroll) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "scroll",
          instanceId: scroll.instanceId,
        });
      }
      const equipment = loser.equipment[0];
      if (equipment) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "equipment",
          instanceId: equipment.instanceId,
        });
      }
      return gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });
    }
    case "equipmentChoice":
      return gameReducer(state, { type: "chooseEquipment" });
    case "gameOver":
      return state;
  }
}

describe("game engine", () => {
  it("accepts player names and preserves them when restarting", () => {
    let state = createInitialGame(20260806, {
      player1: "云雀",
      player2: "长风",
    });

    expect(state.players.player1.name).toBe("云雀");
    expect(state.players.player2.name).toBe("长风");

    state = gameReducer(state, { type: "restart", seed: 42 });

    expect(state.players.player1.name).toBe("云雀");
    expect(state.players.player2.name).toBe("长风");
  });

  it("replays deterministically from the same seed", () => {
    let first = createInitialGame(20260805);
    let second = createInitialGame(20260805);

    for (let step = 0; step < 80; step += 1) {
      first = advanceAutomatically(first);
      second = advanceAutomatically(second);
    }

    expect(second).toEqual(first);
  });

  it("非 Boss 战的卷轴和装备奖励各有 50% 概率，不受怪物种类影响", () => {
    for (const enemyId of ["slime", "golem"] as const) {
      const outcomes = new Set<"scroll" | "equipment">();

      for (let seed = 1; seed <= 100 && outcomes.size < 2; seed += 1) {
        let state = createInitialGame(seed);
        state.players.player1.baseAttack = 99;
        state.phase = {
          kind: "battle",
          battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId, hpB: 1 }),
        };

        state = resolveRound(state);
        outcomes.add(state.players.player1.scrolls.length > 0 ? "scroll" : "equipment");
      }

      expect(outcomes).toEqual(new Set(["scroll", "equipment"]));
    }
  });

  it("keeps core state inside valid bounds during a full automated game", () => {
    let state = createInitialGame(PLAYTHROUGH_SEED);

    for (let step = 0; step < PLAYTHROUGH_CAP && state.phase.kind !== "gameOver"; step += 1) {
      state = advanceAutomatically(state);
      for (const player of Object.values(state.players)) {
        expect(player.position).toBeGreaterThanOrEqual(0);
        expect(player.position).toBeLessThan(state.map.tiles.length);
        expect(player.hp).toBeGreaterThanOrEqual(1);
        expect(player.hp).toBeLessThanOrEqual(player.maxHp);
        for (const [category, limit] of Object.entries(EQUIPMENT_SLOT_LIMITS)) {
          expect(player.equipment.filter(
            (item) => equipmentCategory(item.kind) === category,
          ).length).toBeLessThanOrEqual(limit);
        }
      }
    }

    expect(state.phase.kind).toBe("gameOver");
  });

  it("装备槽满时只允许替换同类装备，也可以放弃新装备", () => {
    let state = createInitialGame(77);
    state.players.player1.equipment = [
      { instanceId: "shield-old", kind: "shield" },
    ];
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "leather-new", kind: "borderLeather" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };

    state = gameReducer(state, {
      type: "chooseEquipment",
      replaceInstanceId: "shield-old",
    });
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players.player1.equipment).toEqual([
      { instanceId: "leather-new", kind: "borderLeather" },
    ]);

    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "leather-discard", kind: "borderLeather" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };
    state = gameReducer(state, { type: "chooseEquipment" });
    expect(state.players.player1.equipment.map((item) => item.instanceId))
      .toEqual(["leather-new"]);
  });

  it("旅行者短靴把移动骰从 D6 提高到 D7", () => {
    let state = createInitialGame(123);
    state.players[state.activePlayerId].equipment = [
      { instanceId: "boots-1", kind: "travelerBoots" },
    ];

    state = gameReducer(state, { type: "rollMovement" });
    const movement = state.lastEvents.find((event) => event.type === "movementRolled");
    if (movement?.type !== "movementRolled") throw new Error("应产生移动投骰事件");
    expect(movement.sides).toBe(7);
    expect(movement.value).toBeLessThanOrEqual(7);
  });

  it("进入 PvE 时按移动前的位置锁定战败休整点", () => {
    let state: GameState | undefined;
    let roll = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const candidate = createInitialGame(seed);
      candidate.players.player1.position = 10;
      const preview = gameReducer(candidate, { type: "rollMovement" });
      const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
      if (movement?.type === "movementRolled" && movement.value >= 2) {
        state = candidate;
        roll = movement.value;
        break;
      }
    }
    if (!state) throw new Error("20 个种子内应当能找到至少移动 2 格的一次投骰");

    // 4 是移动前已有的最近泉水；11 是这次前进途中刚越过的泉水。
    for (let index = 1; index <= 10; index += 1) state.map.tiles[index].type = "event";
    state.map.tiles[4].type = "spring";
    state.map.tiles[11].type = "spring";
    const target = state.map.tiles[10 + roll];
    target.type = "battle";
    target.enemyId = "slime";
    delete target.eliteAffix;

    state = gameReducer(state, { type: "rollMovement" });

    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind === "battle") {
      expect(state.phase.battle.retreatTo).toBe(4);
      expect(state.phase.battle.retreatTo).toBeLessThanOrEqual(10);
    }
  });

  it("restores real player health after a PvP battle", () => {
    let state = createInitialGame(42);
    state.players.player1.hp = 11;
    state.players.player2.hp = 15;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpA: 11,
        hpB: 15,
        initiativeB: 2,
      }),
    };

    for (let step = 0; step < 100 && state.phase.kind === "battle"; step += 1) {
      state = resolveRound(state);
    }

    expect(state.phase.kind).toBe("pvpPenalty");
    expect(state.players.player1.hp).toBe(11);
    expect(state.players.player2.hp).toBe(15);
  });

  it("deals zero damage when defense is higher than attack", () => {
    let state = createInitialGame(7);
    state.players.player2.baseDefense = 100;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
      }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind === "battle") {
      expect(state.phase.battle.hpB).toBe(18);
      expect(state.phase.battle.log[0]).toContain("受到 0 点伤害");
    }
  });
});
