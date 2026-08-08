import { describe, expect, it } from "vitest";
import { createInitialGame } from "../game/engine";
import { makeBattle } from "../game/testSupport";
import { actionGuidance } from "./ActionDock";

describe("行动区阶段提示", () => {
  it("移动阶段指向当前行动玩家", () => {
    const state = createInitialGame(1);
    const guidance = actionGuidance(state, 6);

    expect(guidance).toMatchObject({
      label: "移动阶段",
      action: "投掷 D6",
      actorIds: [state.activePlayerId],
    });
  });

  it("双方秘密选择时只保留尚未提交的操作方", () => {
    const state = createInitialGame(2);
    state.phase = {
      kind: "encounterDecision",
      encounter: {
        aPlayerId: "player1",
        bPlayerId: "player2",
        tileIndex: 1,
        choiceA: { status: "chosen", intent: "trade" },
        choiceB: { status: "pending" },
      },
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "相遇抉择",
      actorIds: ["player2"],
    });
  });

  it("战斗提示跟随当前攻防顺序，而不是地图行动者", () => {
    const state = createInitialGame(3);
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        attacker: "b",
      }),
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "战斗阶段 · 攻击方",
      action: "选择本轮卷轴",
      actorIds: ["player2"],
    });
  });
});
