import { describe, expect, it } from "vitest";
import type { GameEvent } from "../game/types";
import { pendingDecision, presentationReady } from "./PhaseOverlayRouter";
import { createInitialGame } from "../game/engine";

function narration(id: number): GameEvent {
  return { id, type: "narration", text: `事件 ${id}` };
}

describe("阶段弹窗揭示边界", () => {
  it("前置事件仍在当前或待播队列中时保持隐藏", () => {
    expect(presentationReady({
      event: narration(10),
      pending: [narration(11), narration(12)],
    }, 11)).toBe(false);
  });

  it("前置事件播完后立即揭示，不等待后续结果旁白", () => {
    expect(presentationReady({
      event: narration(12),
      pending: [narration(13)],
    }, 11)).toBe(true);
  });

  it("没有边界的旧状态立即可见", () => {
    expect(presentationReady({
      event: narration(1),
      pending: [narration(2)],
    })).toBe(true);
  });

  it("商会驿站选择可以最小化并恢复", () => {
    const state = createInitialGame(4);
    state.phase = {
      kind: "mapEventTravelChoice",
      choice: {
        playerId: "player1",
        targetTileIndex: 8,
        price: 100,
        eventKind: "commerceOutpost",
        effectIndex: 0,
      },
    };

    expect(pendingDecision(state)).toMatchObject({ label: "继续商会驿站行程" });
  });

  it("调和选择可以最小化并恢复", () => {
    const state = createInitialGame(5);
    state.phase = {
      kind: "mapEventHarmonyChoice",
      choice: {
        playerId: "player1",
        amount: 1,
        eventKind: "harmony",
        effectIndex: 0,
      },
    };

    expect(pendingDecision(state)).toMatchObject({ label: "继续调和攻防" });
  });
});
