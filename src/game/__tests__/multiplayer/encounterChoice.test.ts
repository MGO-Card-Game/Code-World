import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { canAct, currentActor } from "../../multiplayer";
import type { PlayerId } from "../../types";

const PLAYER3: PlayerId = "player3";

function gameWithTwoOpponentsAtDestination(seed = 4242) {
  const initial = createInitialGame(seed, {}, ["player1", "player2", PLAYER3]);
  const probe = gameReducer(structuredClone(initial), { type: "rollMovement" });
  const destination = probe.players[initial.activePlayerId].position;
  const destinationTile = initial.map.tiles[destination];
  destinationTile.type = "event";
  delete destinationTile.safeZone;
  delete destinationTile.enemyId;
  delete destinationTile.eliteAffix;
  const opponentIds = initial.turnOrder.filter((id) => id !== initial.activePlayerId);
  for (const id of opponentIds) initial.players[id].position = destination;
  return { state: initial, opponentIds, destination };
}

describe("多人同格相遇目标选择", () => {
  it("同格有两名对手时先选目标，再与目标协商相遇意向", () => {
    const prepared = gameWithTwoOpponentsAtDestination();
    const challengerId = prepared.state.activePlayerId;
    const targetId = prepared.opponentIds[1];
    let state = gameReducer(prepared.state, { type: "rollMovement" });

    expect(state.phase).toEqual({
      kind: "encounterChoice",
      choice: {
        challengerId,
        opponentIds: prepared.opponentIds,
        tileIndex: prepared.destination,
      },
    });
    expect(currentActor(state)).toBe(challengerId);
    expect(canAct(state, { type: "chooseEncounterOpponent", opponentId: targetId }, challengerId)).toBe(true);
    expect(canAct(state, { type: "chooseEncounterOpponent", opponentId: targetId }, prepared.opponentIds[0])).toBe(false);

    state = gameReducer(state, { type: "chooseEncounterOpponent", opponentId: targetId });
    expect(state.phase.kind).toBe("encounterDecision");
    if (state.phase.kind !== "encounterDecision") return;
    expect(state.phase.encounter.aPlayerId).toBe(challengerId);
    expect(state.phase.encounter.bPlayerId).toBe(targetId);

    state = gameReducer(state, { type: "chooseEncounterIntent", side: "a", intent: "battle" });
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind !== "battle") return;
    expect(state.phase.battle.kind).toBe("pvp");
    expect(state.phase.battle.aPlayerId).toBe(challengerId);
    expect(state.phase.battle.bPlayerId).toBe(targetId);
  });

  it("拒绝候选名单外或已经离开该格的目标", () => {
    const prepared = gameWithTwoOpponentsAtDestination(99);
    const targetId = prepared.opponentIds[1];
    const choosing = gameReducer(prepared.state, { type: "rollMovement" });
    expect(choosing.phase.kind).toBe("encounterChoice");

    const invalid = gameReducer(choosing, {
      type: "chooseEncounterOpponent",
      opponentId: choosing.activePlayerId,
    });
    expect(invalid).toBe(choosing);

    choosing.players[targetId].position -= 1;
    const movedAway = gameReducer(choosing, {
      type: "chooseEncounterOpponent",
      opponentId: targetId,
    });
    expect(movedAway).toBe(choosing);
  });

  it("掉线玩家不会成为新的相遇战目标", () => {
    const prepared = gameWithTwoOpponentsAtDestination(123);
    prepared.state.unavailablePlayerIds = [prepared.opponentIds[1]];

    const state = gameReducer(prepared.state, { type: "rollMovement" });

    expect(state.phase.kind).toBe("encounterDecision");
    if (state.phase.kind !== "encounterDecision") return;
    expect(state.phase.encounter.bPlayerId).toBe(prepared.opponentIds[0]);
  });

  it("选择阶段所有候选人都掉线超时后跳过相遇战并继续结算格子", () => {
    const prepared = gameWithTwoOpponentsAtDestination(321);
    let state = gameReducer(prepared.state, { type: "rollMovement" });
    expect(state.phase.kind).toBe("encounterChoice");
    state.unavailablePlayerIds = [...prepared.opponentIds];

    state = handleDisconnectTimeout(state, prepared.opponentIds[0]);

    expect(state.phase.kind).not.toBe("encounterChoice");
    expect(state.history.some((entry) => entry.text.includes("跳过相遇战"))).toBe(true);
  });
});
