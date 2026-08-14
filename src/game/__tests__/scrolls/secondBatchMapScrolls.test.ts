import { describe, expect, it } from "vitest";
import { drawableScrollKinds } from "../../content/scrolls";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { canAct } from "../../multiplayer";
import type { GameEvent, GameState, PlayerId, ScrollKind } from "../../types";

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T) {
  return state.lastEvents.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

function withScroll(kind: ScrollKind, playerIds: PlayerId[] = ["player1", "player2"]) {
  const state = createInitialGame(20260814, {}, playerIds);
  const player = state.players[state.activePlayerId];
  player.position = 10;
  player.scrolls = [{ instanceId: "card-1", kind }];
  return { state, playerId: player.id };
}

function play(state: GameState) {
  return gameReducer(state, { type: "useMapScroll", instanceId: "card-1" });
}

describe("第二批地图卷轴", () => {
  it("搜刮只允许选择有卷轴的玩家，并随机转移一张暗牌", () => {
    const { state, playerId } = withScroll("plunder", ["player1", "player2", "player3"]);
    const targets = state.turnOrder.filter((id) => id !== playerId);
    state.players[targets[0]].scrolls = [
      { instanceId: "loot-1", kind: "might" },
      { instanceId: "loot-2", kind: "guard" },
    ];

    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应进入选人阶段");
    expect(played.phase.choice.candidateIds).toEqual([targets[0]]);

    const resolved = gameReducer(played, { type: "chooseScrollTarget", targetId: targets[0] });
    expect(resolved.players[playerId].scrolls).toHaveLength(1);
    expect(resolved.players[targets[0]].scrolls).toHaveLength(1);
    expect(eventsOf(resolved, "scrollTransferred")).toHaveLength(1);
    expect(resolved.phase.kind).toBe("awaitingRoll");
  });

  it("缴械由目标本人从自己的暗牌中选择一张弃掉", () => {
    const { state, playerId } = withScroll("disarm");
    const targetId = state.turnOrder.find((id) => id !== playerId)!;
    state.players[targetId].scrolls = [
      { instanceId: "keep", kind: "might" },
      { instanceId: "discard", kind: "guard" },
    ];

    const targeted = play(state);
    if (targeted.phase.kind !== "scrollTargetChoice") throw new Error("应进入选人阶段");
    const choosing = gameReducer(targeted, { type: "chooseScrollTarget", targetId });
    expect(choosing.phase.kind).toBe("scrollDiscardChoice");
    if (choosing.phase.kind !== "scrollDiscardChoice") return;
    expect(canAct(choosing, { type: "chooseScrollDiscard", instanceId: "discard" }, targetId))
      .toBe(true);
    expect(canAct(choosing, { type: "chooseScrollDiscard", instanceId: "discard" }, playerId))
      .toBe(false);

    const resolved = gameReducer(choosing, {
      type: "chooseScrollDiscard",
      instanceId: "discard",
    });
    expect(resolved.players[targetId].scrolls.map((scroll) => scroll.instanceId))
      .toEqual(["keep"]);
    expect(resolved.phase.kind).toBe("awaitingRoll");
  });

  it("缴械目标掉线时自动弃掉候选中的第一张牌，不会锁局", () => {
    const { state, playerId } = withScroll("disarm");
    const targetId = state.turnOrder.find((id) => id !== playerId)!;
    state.players[targetId].scrolls = [{ instanceId: "discard", kind: "guard" }];
    const targeted = play(state);
    if (targeted.phase.kind !== "scrollTargetChoice") throw new Error("应进入选人阶段");
    const choosing = gameReducer(targeted, { type: "chooseScrollTarget", targetId });
    const offline = structuredClone(choosing);
    offline.unavailablePlayerIds = [targetId];

    const resolved = handleDisconnectTimeout(offline, targetId);

    expect(resolved.players[targetId].scrolls).toHaveLength(0);
    expect(resolved.phase.kind).toBe("awaitingRoll");
  });

  it("绊马索让目标下一次掷骰移动结果 -2，最低仍为 1", () => {
    const { state, playerId } = withScroll("caltrop");
    const targetId = state.turnOrder.find((id) => id !== playerId)!;
    const targeted = play(state);
    if (targeted.phase.kind !== "scrollTargetChoice") throw new Error("应进入选人阶段");
    let resolved = gameReducer(targeted, { type: "chooseScrollTarget", targetId });
    expect(resolved.players[targetId].nextMovementRollPenalty).toBe(2);

    resolved = structuredClone(resolved);
    resolved.activePlayerId = targetId;
    resolved.phase = { kind: "awaitingRoll" };
    resolved.players[targetId].forcedMovementRoll = 2;
    const moved = gameReducer(resolved, { type: "rollMovement" });

    expect(eventsOf(moved, "movementRolled")[0].value).toBe(1);
    expect(moved.players[targetId].nextMovementRollPenalty).toBeUndefined();
  });

  it("回城卷轴传送到本阶段营地、回满生命并增加一圈", () => {
    const { state, playerId } = withScroll("townPortal");
    const player = state.players[playerId];
    const region = state.map.regions[0];
    player.hp = 1;
    const lapsBefore = player.stageProgress[region.id].laps;

    const resolved = play(state);

    expect(resolved.players[playerId].position).toBe(region.entryIndex);
    expect(resolved.players[playerId].hp).toBe(resolved.players[playerId].maxHp);
    expect(resolved.players[playerId].stageProgress[region.id].laps).toBe(lapsBefore + 1);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("折返回到上一次停留的同阶段格子，结算后可以再折回当前格", () => {
    const { state, playerId } = withScroll("retrace");
    const player = state.players[playerId];
    player.previousStopPosition = 5;
    state.map.tiles[5] = {
      id: 5,
      region: "foothill",
      type: "spring",
      label: "测试泉水",
    };
    player.hp = 1;

    const resolved = play(state);

    expect(resolved.players[playerId].position).toBe(5);
    expect(resolved.players[playerId].previousStopPosition).toBe(10);
    expect(resolved.players[playerId].hp).toBeGreaterThan(1);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("折返没有历史位置或历史位置不在当前阶段时不能使用", () => {
    for (const previous of [undefined, 40] as const) {
      const { state, playerId } = withScroll("retrace");
      state.players[playerId].previousStopPosition = previous;
      expect(play(state)).toBe(state);
    }
  });

  it("五张新地图卷轴全部进入随机卡池", () => {
    const drawable = drawableScrollKinds();
    for (const kind of ["plunder", "disarm", "caltrop", "townPortal", "retrace"] as const) {
      expect(drawable).toContain(kind);
    }
  });
});
