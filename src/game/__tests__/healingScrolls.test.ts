import { describe, expect, it } from "vitest";
import { SCROLLS, scrollCategory } from "../content/scrolls";
import { createInitialGame, gameReducer } from "../engine";
import { makeBattle, resolveRound } from "../testSupport";
import type { GameEvent, GameState, ScrollKind } from "../types";

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

describe("疗牌分类", () => {
  it("两张疗牌在地图、攻击和防御阶段都可使用", () => {
    for (const kind of ["firstAidBandage", "battlefieldMedicine"] as const) {
      expect(scrollCategory(SCROLLS[kind])).toBe("healing");
      expect(SCROLLS[kind].timings).toEqual([
        "map",
        "beforeAttackRoll",
        "beforeDefenseRoll",
      ]);
    }
  });
});

describe("地图阶段使用疗牌", () => {
  it("急救绷带恢复 3 点，并且移动前后都能使用", () => {
    for (const phase of ["awaitingRoll", "turnComplete"] as const) {
      const initial = createInitialGame(7);
      const player = initial.players[initial.activePlayerId];
      player.hp = 10;
      const instanceId = giveScroll(initial, "firstAidBandage");
      initial.phase = { kind: phase };

      const state = gameReducer(initial, { type: "useMapScroll", instanceId });

      expect(state).not.toBe(initial);
      expect(state.players[state.activePlayerId].hp).toBe(13);
      expect(state.players[state.activePlayerId].scrolls).toHaveLength(0);
      expect(state.phase.kind).toBe(phase);
      expect(only(state.lastEvents, "playerHpChanged").reason).toBe("scroll");
      expect(only(state.lastEvents, "scrollConsumed").kind).toBe("firstAidBandage");
    }
  });

  it("战地药剂恢复 5 点并放弃本回合移动", () => {
    const initial = createInitialGame(7);
    const player = initial.players[initial.activePlayerId];
    player.hp = 10;
    const instanceId = giveScroll(initial, "battlefieldMedicine");

    const state = gameReducer(initial, { type: "useMapScroll", instanceId });

    expect(state.players[state.activePlayerId].hp).toBe(15);
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players[state.activePlayerId].skipNextMovement).toBeUndefined();
  });

  it("已经移动后不能再用战地药剂规避代价", () => {
    const state = createInitialGame(7);
    state.players[state.activePlayerId].hp = 10;
    const instanceId = giveScroll(state, "battlefieldMedicine");
    state.phase = { kind: "turnComplete" };

    expect(gameReducer(state, { type: "useMapScroll", instanceId })).toBe(state);
    expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
  });

  it("满血时不会浪费疗牌，非疗牌也不能在地图打出", () => {
    for (const kind of ["firstAidBandage", "might"] as const) {
      const state = createInitialGame(7);
      const instanceId = giveScroll(state, kind);

      expect(gameReducer(state, { type: "useMapScroll", instanceId })).toBe(state);
      expect(state.players[state.activePlayerId].scrolls).toHaveLength(1);
    }
  });
});

describe("战斗阶段使用疗牌", () => {
  it("急救绷带恢复使用方的战斗生命，并产生治疗事件", () => {
    let state = createInitialGame(7);
    state.players.player1.hp = 10;
    state.players.player1.scrolls = [
      { instanceId: "bandage-1", kind: "firstAidBandage" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "slime",
        hpA: 10,
      }),
    };

    state = resolveRound(state, { attack: "bandage-1" });

    const healed = only(state.lastEvents, "battleHealed");
    expect(healed.targetSide).toBe("a");
    expect(healed.hpBefore).toBe(10);
    expect(healed.hpAfter).toBe(13);
    expect(healed.amount).toBe(3);
  });

  it("防守方也能用疗牌，PvP 中只修改战斗生命", () => {
    let state = createInitialGame(7);
    state.players.player2.hp = 12;
    state.players.player2.scrolls = [
      { instanceId: "bandage-2", kind: "firstAidBandage" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpB: 12,
      }),
    };

    state = resolveRound(state, { defense: "bandage-2" });

    const healed = only(state.lastEvents, "battleHealed");
    expect(healed.targetSide).toBe("b");
    expect(healed.hpAfter).toBe(15);
    expect(state.players.player2.hp).toBe(12);
  });

  it("战斗中使用战地药剂会锁住自己的下一次地图移动", () => {
    let state = createInitialGame(7);
    state.players.player1.hp = 10;
    state.players.player1.scrolls = [
      { instanceId: "medicine-1", kind: "battlefieldMedicine" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "slime",
        hpA: 10,
      }),
    };

    state = resolveRound(state, { attack: "medicine-1" });

    expect(state.players.player1.skipNextMovement).toBe(true);
    expect(only(state.lastEvents, "battleHealed").amount).toBe(5);
  });

  it("移动锁在该玩家下次轮到时自动兑现", () => {
    const initial = createInitialGame(7);
    initial.activePlayerId = "player2";
    initial.phase = { kind: "turnComplete" };
    initial.players.player1.skipNextMovement = true;

    const state = gameReducer(initial, { type: "endTurn" });

    expect(state.activePlayerId).toBe("player1");
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players.player1.skipNextMovement).toBeUndefined();
    expect(state.message.text).toContain("无法移动");
  });
});
