import { describe, expect, it } from "vitest";
import { SCROLLS, scrollCategory } from "../../content/scrolls";
import { createInitialGame, gameReducer } from "../../engine";
import type { GameEvent, GameState, ScrollKind } from "../../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

function giveScroll(state: GameState, kind: ScrollKind, instanceId = `${kind}-1`) {
  state.players[state.activePlayerId].scrolls = [{ instanceId, kind }];
  return instanceId;
}

describe("移动类卷轴分类", () => {
  it("四张卡都只能在地图阶段使用，牌面归入通用牌", () => {
    for (const kind of [
      "remoteDice", "shortRangeTeleportCharm", "withinReach", "anywhereDoor",
    ] as const) {
      expect(SCROLLS[kind].timings).toEqual(["map"]);
      expect(scrollCategory(SCROLLS[kind])).toBe("universal");
    }
  });
});

describe("遥控骰子（自选移动点数）", () => {
  it("只能在还没掷骰时使用", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "remoteDice");
    state.phase = { kind: "turnComplete" };

    const result = gameReducer(state, { type: "useMapScroll", instanceId, distance: 3 });

    expect(result).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("点数超出当前移动骰上限或缺省时拒绝", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "remoteDice");
    state.phase = { kind: "awaitingRoll" };

    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 7 })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 0 })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("指定点数移动，逐格前进，途中经过营地照常回血、计入守关门圈数", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.position = initial.map.regions[0].endIndex; // 守关门在 0，营地在 1
    player.hp = 10;
    initial.map.tiles[2].type = "start"; // 落点设为无副作用格，断言不被随机内容干扰
    const instanceId = giveScroll(initial, "remoteDice");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, distance: 3 });

    expect(state).not.toBe(initial);
    expect(state.players[state.activePlayerId].position).toBe(2);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(0);
    expect(state.players[state.activePlayerId].stageProgress.foothill.laps).toBe(1);
    // 途中经过营地（位置 1），应当照常回满生命
    expect(only(state.lastEvents, "playerHpChanged").reason).toBe("camp");
    expect(state.players[state.activePlayerId].hp).toBe(state.players[state.activePlayerId].maxHp);
    const rolled = only(state.lastEvents, "movementRolled");
    expect(rolled.value).toBe(3);
    expect(only(state.lastEvents, "scrollConsumed").kind).toBe("remoteDice");
  });
});

describe("短程传送符（跳跃）", () => {
  it("只能在还没掷骰时使用，距离超出上限时拒绝", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "shortRangeTeleportCharm");
    state.phase = { kind: "awaitingRoll" };

    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 4 })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);

    state.phase = { kind: "turnComplete" };
    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 2 })).toBe(state);
  });

  it("跃过营地和守关门时都不结算：不回血、不计圈数，只有落点格子生效", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    const region = initial.map.regions[0];
    player.position = region.endIndex; // 与遥控骰子用例相同的起点和距离，落点同样是 2
    player.hp = 10;
    initial.map.tiles[2].type = "start";
    const instanceId = giveScroll(initial, "shortRangeTeleportCharm");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, distance: 3 });

    expect(state.players[state.activePlayerId].position).toBe(2);
    expect(state.players[state.activePlayerId].hp).toBe(10); // 没有触发营地回血
    expect(state.players[state.activePlayerId].stageProgress.foothill.laps).toBe(0); // 没有触发守关门计次
    expect(state.lastEvents.some((event) => event.type === "playerHpChanged")).toBe(false);
    expect(state.lastEvents.some((event) => event.type === "movementRolled")).toBe(false);
    expect(only(state.lastEvents, "playerMoved")).toMatchObject({ from: region.endIndex, to: 2 });
    expect(only(state.lastEvents, "scrollConsumed").kind).toBe("shortRangeTeleportCharm");
  });

  it("直接落在营地格上时仍然回血", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.position = initial.map.regions[0].endIndex - 1; // +3 恰好落在营地（位置 1）
    player.hp = 10;
    const instanceId = giveScroll(initial, "shortRangeTeleportCharm");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, distance: 3 });

    expect(state.players[state.activePlayerId].position).toBe(1);
    expect(only(state.lastEvents, "playerHpChanged").reason).toBe("camp");
    expect(state.players[state.activePlayerId].hp).toBe(state.players[state.activePlayerId].maxHp);
  });
});

describe("触手可得（固定前进 1 格）", () => {
  it("只能前进 1 格，多于或少于都被拒绝", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "withinReach");
    state.phase = { kind: "awaitingRoll" };

    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 2 })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId, distance: 0 })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("使用后前进 1 格，代替正常移动", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.position = 5;
    initial.map.tiles[6].type = "start";
    const instanceId = giveScroll(initial, "withinReach");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, distance: 1 });

    expect(state.players[state.activePlayerId].position).toBe(6);
    expect(only(state.lastEvents, "playerMoved")).toMatchObject({ from: 5, to: 6 });
    expect(only(state.lastEvents, "scrollConsumed").kind).toBe("withinReach");
  });
});

describe("任意门（不限距离的传送）", () => {
  it("只能在还没掷骰时使用", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "anywhereDoor");
    state.phase = { kind: "turnComplete" };

    expect(gameReducer(state, { type: "useMapScroll", instanceId, targetPosition: 20 })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("目标超出当前阶段范围或缺省时拒绝", () => {
    const state = createInitialGame(7);
    const region = state.map.regions[0];
    state.players[state.activePlayerId].position = 5;
    const instanceId = giveScroll(state, "anywhereDoor");
    state.phase = { kind: "awaitingRoll" };

    expect(gameReducer(state, {
      type: "useMapScroll",
      instanceId,
      targetPosition: region.endIndex + 1,
    })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId, targetPosition: -1 })).toBe(state);
    expect(gameReducer(state, { type: "useMapScroll", instanceId })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("可以跳到当前阶段内任意一格，不产生掷骰事件，只结算落点", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.position = 5;
    initial.map.tiles[20].type = "start";
    const instanceId = giveScroll(initial, "anywhereDoor");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, targetPosition: 20 });

    expect(state.players[state.activePlayerId].position).toBe(20);
    expect(state.lastEvents.some((event) => event.type === "movementRolled")).toBe(false);
    expect(only(state.lastEvents, "playerMoved")).toMatchObject({ from: 5, to: 20 });
    expect(only(state.lastEvents, "scrollConsumed").kind).toBe("anywhereDoor");
  });

  it("直接落在营地或守关门格上时，落点规则照常生效", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.position = 5;
    player.hp = 10;
    const instanceId = giveScroll(initial, "anywhereDoor");
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId, targetPosition: 1 });

    expect(state.players[state.activePlayerId].position).toBe(1); // 营地
    expect(only(state.lastEvents, "playerHpChanged").reason).toBe("camp");
    expect(state.players[state.activePlayerId].hp).toBe(state.players[state.activePlayerId].maxHp);
  });
});
