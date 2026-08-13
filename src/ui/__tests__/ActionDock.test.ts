import { describe, expect, it } from "vitest";
import { createInitialGame } from "../../game/engine";
import { makeBattle } from "../../game/testSupport";
import { actionGuidance } from "../ActionDock";

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

  it("多颗移动骰会显示完整骰子记法", () => {
    const state = createInitialGame(1);

    expect(actionGuidance(state, 6, 2).action).toBe("投掷 2D6");
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

  it("卷轴复制阶段指向事件当事人", () => {
    const state = createInitialGame(4);
    state.phase = {
      kind: "mapEventScrollChoice",
      choice: {
        playerId: "player2",
        candidateIds: ["scroll-1"],
        eventKind: "twinSlayer",
        effectIndex: 0,
      },
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "双子杀手",
      action: "选择一张卷轴进行复制",
      actorIds: ["player2"],
    });
  });

  it("收藏家交易阶段指向事件当事人", () => {
    const state = createInitialGame(5);
    state.phase = {
      kind: "mapEventEquipmentChoice",
      choice: {
        playerId: "player2",
        candidateIds: ["equipment-1"],
        eventKind: "weaponCollector",
        effectIndex: 0,
      },
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "武器收藏家",
      action: "交出一件装备或拒绝交易",
      actorIds: ["player2"],
    });
  });

  it("商会驿站阶段提示付费前往商店或放弃", () => {
    const state = createInitialGame(6);
    state.phase = {
      kind: "mapEventTravelChoice",
      choice: {
        playerId: "player2",
        targetTileIndex: 8,
        price: 100,
        eventKind: "commerceOutpost",
        effectIndex: 0,
      },
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "商会驿站",
      action: "支付路费前往商店或放弃行程",
      actorIds: ["player2"],
    });
  });

  it("调和阶段提示转换攻防或放弃", () => {
    const state = createInitialGame(7);
    state.phase = {
      kind: "mapEventHarmonyChoice",
      choice: {
        playerId: "player2",
        amount: 1,
        eventKind: "harmony",
        effectIndex: 0,
      },
    };

    expect(actionGuidance(state, 6)).toMatchObject({
      label: "调和",
      action: "转换 1 点基础攻防或放弃调和",
      actorIds: ["player2"],
    });
  });
});
