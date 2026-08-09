import { describe, expect, it } from "vitest";
import { drawableScrollKinds } from "../content/scrolls";
import { EXTORTION_GOLD } from "../content/scrolls/interference";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../engine";
import { MAP_REGION_SIZE } from "../map";
import { canAct } from "../multiplayer";
import type { GameEvent, GameState, PlayerId, ScrollKind } from "../types";

/**
 * 干扰牌与翻跟头。
 *
 * 它们原本是地图事件，改成卷轴之后便宜了一大截：卷轴在 engine 里结算，而 engine
 * 是所有模块的上游，落点结算可以直接调 resolveTile，不用再把"欠一次格子结算"
 * 交回上层兑现。
 */

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T) {
  return state.lastEvents.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

/** 摆一局：行动玩家手上有指定的牌，其余人挪到 0 号格。 */
function withScroll(
  kind: ScrollKind,
  options: { seed?: number; playerIds?: PlayerId[] } = {},
) {
  const state = createInitialGame(
    options.seed ?? 20260805,
    {},
    options.playerIds ?? ["player1", "player2"],
  );
  const player = state.players[state.activePlayerId];
  player.position = 10;
  player.scrolls = [{ instanceId: "card-1", kind }];
  for (const candidate of Object.values(state.players)) {
    if (candidate.id !== player.id) candidate.position = 0;
  }
  return { state, playerId: player.id };
}

function play(state: GameState, instanceId = "card-1") {
  return gameReducer(state, { type: "useMapScroll", instanceId });
}

describe("干扰牌的选人阶段", () => {
  it("打出后先消耗牌再停在选人阶段，名单里没有自己", () => {
    const { state, playerId } = withScroll("tripwire");

    const played = play(state);

    expect(played.phase.kind).toBe("scrollTargetChoice");
    if (played.phase.kind !== "scrollTargetChoice") return;
    expect(played.phase.choice.playerId).toBe(playerId);
    expect(played.phase.choice.candidateIds).not.toContain(playerId);
    expect(played.phase.choice.scrollKind).toBe("tripwire");
    // 牌先消耗掉：打出去的牌不退回，中途掉线也不会变回手上
    expect(played.players[playerId].scrolls).toHaveLength(0);
    expect(eventsOf(played, "scrollConsumed")).toHaveLength(1);
  });

  it("只认名单里的目标，也只有出牌者能选", () => {
    const { state, playerId } = withScroll("tripwire");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];

    // 非法目标一律原样返回旧 state，维持“非法动作不产生新状态”的约定
    expect(gameReducer(played, { type: "chooseScrollTarget", targetId: playerId }))
      .toBe(played);
    expect(gameReducer(played, { type: "chooseScrollTarget", targetId: "player4" }))
      .toBe(played);
    expect(canAct(played, { type: "chooseScrollTarget", targetId }, playerId)).toBe(true);
    expect(canAct(played, { type: "chooseScrollTarget", targetId }, targetId)).toBe(false);
  });

  it("选完之后回到出牌时那个阶段，掷骰机会还在", () => {
    const { state } = withScroll("tripwire");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");

    const resolved = gameReducer(played, {
      type: "chooseScrollTarget",
      targetId: played.phase.choice.candidateIds[0],
    });

    // 绊索不代替移动，所以打完还能照常掷骰
    expect(resolved.phase.kind).toBe("awaitingRoll");
  });

  it("没有可选目标时打不出去", () => {
    const { state } = withScroll("bodySwap");
    // 唯一的对手推到山腰，同区域内就没人可换了
    const opponent = Object.values(state.players)
      .find((candidate) => candidate.id !== state.activePlayerId)!;
    opponent.position = state.map.regions[1].startIndex + 5;

    expect(play(state)).toBe(state);
  });

  it("选人期间出牌者掉线，则放弃这次针对并结束回合", () => {
    const { state, playerId } = withScroll("extortion");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];
    const goldBefore = played.players[targetId].gold;
    const offline = structuredClone(played);
    offline.unavailablePlayerIds = [playerId];

    const resolved = handleDisconnectTimeout(offline, playerId);

    expect(resolved.players[targetId].gold).toBe(goldBefore);
    expect(resolved.activePlayerId).not.toBe(playerId);
  });
});

describe("勒索信", () => {
  it("按定额转账，对方不够就有多少拿多少", () => {
    for (const [targetGold, expected] of [[400, EXTORTION_GOLD], [30, 30]] as const) {
      const { state, playerId } = withScroll("extortion");
      for (const candidate of Object.values(state.players)) candidate.gold = targetGold;
      const played = play(state);
      if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
      const targetId = played.phase.choice.candidateIds[0];

      const resolved = gameReducer(played, { type: "chooseScrollTarget", targetId });

      expect(resolved.players[targetId].gold).toBe(targetGold - expected);
      expect(resolved.players[playerId].gold).toBe(targetGold + expected);
      // 转账不吃金币获得倍率，两边的增减必须严格相等
      expect(eventsOf(resolved, "goldChanged").map((event) => event.to - event.from))
        .toEqual([-expected, expected]);
    }
  });
});

describe("绊索", () => {
  it("把目标下一次掷骰移动钉死成 1 格，且只生效一次", () => {
    const { state } = withScroll("tripwire");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];

    let resolved = gameReducer(played, { type: "chooseScrollTarget", targetId });
    expect(resolved.players[targetId].forcedMovementRoll).toBe(1);

    // 推进到目标自己的回合再掷骰
    const actor = resolved.players[resolved.activePlayerId];
    const region = resolved.map.regions[0];
    for (let distance = 1; distance <= 6; distance += 1) {
      const local = (actor.position - region.startIndex + distance) % MAP_REGION_SIZE;
      const tile = resolved.map.tiles[region.startIndex + local];
      tile.type = "start";
      tile.safeZone = true;
      delete tile.enemyId;
      delete tile.eliteAffix;
    }
    resolved = gameReducer(resolved, { type: "rollMovement" });
    while (resolved.phase.kind !== "turnComplete") {
      throw new Error(`出牌者这一步不该停在 ${resolved.phase.kind}`);
    }
    resolved = gameReducer(resolved, { type: "endTurn" });
    expect(resolved.activePlayerId).toBe(targetId);

    const before = resolved.players[targetId].position;
    resolved = gameReducer(resolved, { type: "rollMovement" });

    expect(eventsOf(resolved, "movementRolled")[0].value).toBe(1);
    expect(resolved.players[targetId].position).toBe(before + 1);
    // 标记用掉就没了，下一次掷骰恢复正常
    expect(resolved.players[targetId].forcedMovementRoll).toBeUndefined();
  });
});

describe("太空步", () => {
  it("让目标沿环路后退 2 格，不结算落点", () => {
    const { state } = withScroll("moonwalk");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];
    const region = played.map.regions[0];
    const start = region.startIndex + 10;
    const before = structuredClone(played);
    before.players[targetId].position = start;

    const resolved = gameReducer(before, { type: "chooseScrollTarget", targetId });

    expect(resolved.players[targetId].position).toBe(start - 2);
    expect(eventsOf(resolved, "playerMoved")[0])
      .toMatchObject({ playerId: targetId, from: start, to: start - 2 });
    // 落点不结算：不会替别人开战或开商店，出牌者的掷骰机会也还在
    expect(resolved.phase.kind).toBe("awaitingRoll");
  });

  it("倒退跨过守关门时绕回环尾，且不计圈数", () => {
    const { state } = withScroll("moonwalk");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];
    const region = played.map.regions[0];
    // 守关门就在环路起点，所以从它后面一格倒退必然绕到环尾
    expect(region.gateIndex).toBe(region.startIndex);
    const before = structuredClone(played);
    before.players[targetId].position = region.startIndex + 1;
    const lapsBefore = before.players[targetId].stageProgress[region.id].laps;

    const resolved = gameReducer(before, { type: "chooseScrollTarget", targetId });
    const moved = resolved.players[targetId];

    // 绕回本区域环尾，不会越界到上一个区域
    expect(moved.position).toBe(region.startIndex + MAP_REGION_SIZE - 1);
    // 倒着经过守关门不算一圈，否则来回推人就能刷出首领挑战资格
    expect(moved.stageProgress[region.id].laps).toBe(lapsBefore);
  });
});

describe("移形换影", () => {
  it("两枚棋子都动，只有出牌者结算新格子", () => {
    const { state, playerId } = withScroll("bodySwap");
    const played = play(state);
    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    const targetId = played.phase.choice.candidateIds[0];
    const before = structuredClone(played);
    // 把出牌者的落点铺成泉水：它会把落点记成休整点，是个不会和别的效果混淆的证据
    const targetTile = before.players[targetId].position;
    before.map.tiles[targetTile] = {
      id: targetTile,
      region: before.map.tiles[targetTile].region,
      type: "spring",
      label: "测试泉水",
    };
    const playerFrom = before.players[playerId].position;

    const resolved = gameReducer(before, { type: "chooseScrollTarget", targetId });

    expect(resolved.players[playerId].position).toBe(targetTile);
    expect(resolved.players[targetId].position).toBe(playerFrom);
    // 两侧都发 playerMoved，界面才画得出两枚棋子同时移动
    expect(eventsOf(resolved, "playerMoved")).toEqual([
      expect.objectContaining({ playerId, from: playerFrom, to: targetTile }),
      expect.objectContaining({ playerId: targetId, from: targetTile, to: playerFrom }),
    ]);
    // 出牌者结算了新格子；目标那一侧什么都不触发
    expect(resolved.players[playerId].checkpointTileId).toBe(targetTile);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("候选名单只留同区域的玩家，换不到别的区域去", () => {
    const { state } = withScroll("bodySwap", {
      playerIds: ["player1", "player2", "player3"],
    });
    const others = state.turnOrder.filter((id) => id !== state.activePlayerId);
    state.players[others[1]].position = state.map.regions[1].startIndex + 5;

    const played = play(state);

    if (played.phase.kind !== "scrollTargetChoice") throw new Error("应停在选人阶段");
    /*
      跨区域换位等于绕开守关门和阶段首领白拿进度，所以山腰那位根本不该在名单里。
      同区域那位被 withScroll 挪到了 0 号格，他仍是合法目标。
    */
    expect(played.phase.choice.candidateIds).toEqual([others[0]]);
  });

  it("代替本次移动，所以掷完骰就打不出来了", () => {
    const { state } = withScroll("bodySwap");
    const rolled = gameReducer(state, { type: "rollMovement" });
    // 掷完之后阶段不再是 awaitingRoll，这张牌应当被拒
    if (rolled.phase.kind === "awaitingRoll") throw new Error("应当已经移动过");
    if (rolled.phase.kind !== "turnComplete") return;

    expect(play(rolled)).toBe(rolled);
  });
});

describe("翻跟头", () => {
  it("不掷骰白走 2 格，落点照常结算", () => {
    const { state, playerId } = withScroll("somersault");
    const start = state.players[playerId].position;
    const landed = start + 2;
    state.map.tiles[landed] = {
      id: landed,
      region: state.map.tiles[landed].region,
      type: "spring",
      label: "测试泉水",
    };

    const resolved = play(state);
    const settled = resolved.players[playerId];

    expect(settled.position).toBe(landed);
    expect(eventsOf(resolved, "playerMoved")[0])
      .toMatchObject({ playerId, from: start, to: landed });
    // 泉水把落点记成了休整点，说明它确实被结算过
    expect(settled.checkpointTileId).toBe(landed);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("代替本次移动，掷完骰就打不出来了", () => {
    const { state } = withScroll("somersault");
    const rolled = gameReducer(state, { type: "rollMovement" });
    if (rolled.phase.kind !== "turnComplete") return;

    expect(play(rolled)).toBe(rolled);
  });
});

describe("卡池", () => {
  it("这五张都进随机卡池，不是事件专属", () => {
    const drawable = drawableScrollKinds();
    for (const kind of ["tripwire", "extortion", "moonwalk", "bodySwap", "somersault"] as const) {
      expect(drawable).toContain(kind);
    }
  });
});
