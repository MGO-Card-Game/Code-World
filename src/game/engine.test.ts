import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer, MAP } from "./engine";
import { makeBattle, resolveRound } from "./testSupport";
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
      return gameReducer(state, { type: "choosePvpPenalty", choice: "hp" });
    }
    case "gameOver":
      return state;
  }
}

describe("game engine", () => {
  it("replays deterministically from the same seed", () => {
    let first = createInitialGame(20260805);
    let second = createInitialGame(20260805);

    for (let step = 0; step < 80; step += 1) {
      first = advanceAutomatically(first);
      second = advanceAutomatically(second);
    }

    expect(second).toEqual(first);
  });

  it("keeps core state inside valid bounds during a full automated game", () => {
    let state = createInitialGame(981723);

    for (let step = 0; step < 5000 && state.phase.kind !== "gameOver"; step += 1) {
      state = advanceAutomatically(state);
      for (const player of Object.values(state.players)) {
        expect(player.position).toBeGreaterThanOrEqual(0);
        expect(player.position).toBeLessThan(MAP.length);
        expect(player.hp).toBeGreaterThanOrEqual(1);
        expect(player.hp).toBeLessThanOrEqual(player.maxHp);
      }
    }

    expect(state.phase.kind).toBe("gameOver");
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
