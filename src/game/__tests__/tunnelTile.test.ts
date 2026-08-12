import { describe, expect, it } from "vitest";
import { createInitialGame } from "../engine";
import { resolveTile } from "../tiles";

describe("神秘隧道", () => {
  it("落地后移动到另一端并结束回合，不重复结算出口", () => {
    const state = createInitialGame(20260812);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    const entranceId = region.entryIndex + 2;
    const exitId = region.entryIndex + 9;
    state.map.tiles[entranceId] = {
      id: entranceId,
      region: region.id,
      type: "tunnel",
      label: "神秘隧道",
      safeZone: true,
    };
    state.map.tiles[exitId] = {
      id: exitId,
      region: region.id,
      type: "tunnel",
      label: "神秘隧道",
      safeZone: true,
    };
    player.position = entranceId;

    resolveTile(state, state.map.tiles[entranceId]);

    expect(player.position).toBe(exitId);
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.lastEvents.filter((event) => event.type === "playerMoved")).toContainEqual(
      expect.objectContaining({ playerId: player.id, from: entranceId, to: exitId }),
    );
  });
});
