import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer } from "../../engine";
import { getDiceCountBonus } from "../../selectors";

function movementEvent(state: ReturnType<typeof createInitialGame>) {
  const event = state.lastEvents.find((candidate) => candidate.type === "movementRolled");
  if (event?.type !== "movementRolled") throw new Error("应产生移动投骰事件");
  return event;
}

describe("墨竹手环", () => {
  it("普通地图移动额外投 1 颗同面骰，并按总和前进", () => {
    let state = createInitialGame(20260812);
    const player = state.players[state.activePlayerId];
    player.blessings = [];
    player.equipment = [{ instanceId: "ink-bamboo-1", kind: "inkBambooBracelet" }];

    expect(getDiceCountBonus(player, "movement")).toBe(1);
    const from = player.position;
    state = gameReducer(state, { type: "rollMovement" });

    const rolled = movementEvent(state);
    expect(rolled.dice).toHaveLength(2);
    expect(rolled.value).toBe(rolled.dice[0] + rolled.dice[1]);
    expect(state.players[player.id].position).toBe(from + rolled.value);
  });

  it("固定移动点数是最终结果，不会额外投骰", () => {
    let state = createInitialGame(20260813);
    const player = state.players[state.activePlayerId];
    player.blessings = [];
    player.equipment = [{ instanceId: "ink-bamboo-1", kind: "inkBambooBracelet" }];
    player.forcedMovementRoll = 1;

    state = gameReducer(state, { type: "rollMovement" });

    const rolled = movementEvent(state);
    expect(rolled.dice).toEqual([1]);
    expect(rolled.value).toBe(1);
  });
});
