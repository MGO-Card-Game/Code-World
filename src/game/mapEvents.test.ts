import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "./engine";
import type { GameEvent, GameState } from "./types";

function landOnEvent(seed: number) {
  const state = createInitialGame(seed);
  const player = state.players[state.activePlayerId];
  const opponent = Object.values(state.players).find((candidate) => candidate.id !== player.id)!;
  player.position = 10;
  player.hp = 10;
  opponent.position = 0;

  // 先用克隆出来的状态预读移动值；原 state 的随机流没有被消费。
  const preview = gameReducer(state, { type: "rollMovement" });
  const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
  if (movement?.type !== "movementRolled") throw new Error("应该产生移动投骰事件");

  const target = state.map.tiles[player.position + movement.value];
  target.type = "event";
  target.safeZone = false;
  delete target.enemyId;
  delete target.eliteAffix;
  return gameReducer(state, { type: "rollMovement" });
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T) {
  return state.lastEvents.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

describe("地图事件结算", () => {
  it("现有恢复、伤害和卷轴事件都能经注册表真实触发", () => {
    const outcomes = new Set<"heal" | "damage" | "scroll">();

    for (let seed = 1; seed <= 100 && outcomes.size < 3; seed += 1) {
      const state = landOnEvent(seed);
      const player = state.players[state.activePlayerId];
      expect(state.phase.kind).toBe("turnComplete");

      if (player.scrolls.length > 0) {
        outcomes.add("scroll");
        expect(eventsOf(state, "scrollGranted")).toHaveLength(1);
        expect(eventsOf(state, "playerHpChanged")).toHaveLength(0);
      } else if (player.hp > 10) {
        outcomes.add("heal");
        expect(player.hp).toBe(13);
        expect(eventsOf(state, "playerHpChanged")[0]).toMatchObject({
          from: 10,
          to: 13,
          reason: "event",
        });
      } else {
        outcomes.add("damage");
        expect(player.hp).toBe(8);
        expect(eventsOf(state, "playerHpChanged")[0]).toMatchObject({
          from: 10,
          to: 8,
          reason: "event",
        });
      }
    }

    expect(outcomes).toEqual(new Set(["heal", "damage", "scroll"]));
  });

  it("伤害事件不能把玩家降到 1 点以下", () => {
    let checked = false;
    for (let seed = 1; seed <= 100 && !checked; seed += 1) {
      const state = createInitialGame(seed);
      state.players[state.activePlayerId].hp = 1;
      const resolved = landOnEventFrom(state);
      const narration = resolved.message.text;
      if (!narration.includes("山路落石")) continue;
      expect(resolved.players[resolved.activePlayerId].hp).toBe(1);
      expect(eventsOf(resolved, "playerHpChanged")).toHaveLength(0);
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

function landOnEventFrom(state: GameState) {
  const player = state.players[state.activePlayerId];
  const opponent = Object.values(state.players).find((candidate) => candidate.id !== player.id)!;
  player.position = 10;
  opponent.position = 0;
  const preview = gameReducer(state, { type: "rollMovement" });
  const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
  if (movement?.type !== "movementRolled") throw new Error("应该产生移动投骰事件");
  const target = state.map.tiles[player.position + movement.value];
  target.type = "event";
  target.safeZone = false;
  delete target.enemyId;
  delete target.eliteAffix;
  return gameReducer(state, { type: "rollMovement" });
}
