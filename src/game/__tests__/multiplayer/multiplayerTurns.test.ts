import { describe, expect, it } from "vitest";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { makeBattle } from "../../testSupport";

const FOUR_PLAYERS = ["player1", "player2", "player3", "player4"] as const;

describe("三至四人回合顺序", () => {
  it("全员开局投骰不重复，并按点数从高到低行动", () => {
    const state = createInitialGame(20260807, {}, FOUR_PLAYERS);
    const started = state.lastEvents.find((event) => event.type === "gameStarted");
    if (!started || started.type !== "gameStarted") throw new Error("缺少开局事件");

    const orderedRolls = started.turnOrder.map((id) => started.rolls[id]!);
    expect(new Set(orderedRolls).size).toBe(4);
    expect(orderedRolls).toEqual([...orderedRolls].sort((a, b) => b - a));
    expect(state.activePlayerId).toBe(state.turnOrder[0]);
  });

  it("结束回合沿固定顺序循环，不会跳过第三、第四名玩家", () => {
    let state = createInitialGame(4242, {}, FOUR_PLAYERS);
    const observed = [state.activePlayerId];

    for (let index = 0; index < 4; index += 1) {
      state.phase = { kind: "turnComplete" };
      state = gameReducer(state, { type: "endTurn" });
      observed.push(state.activePlayerId);
    }

    expect(observed).toEqual([...state.turnOrder, state.turnOrder[0]]);
  });

  it("回合轮转跳过掉线席位", () => {
    let state = createInitialGame(8080, {}, FOUR_PLAYERS);
    const offline = state.turnOrder[1];
    state.unavailablePlayerIds = [offline];
    state.phase = { kind: "turnComplete" };

    state = gameReducer(state, { type: "endTurn" });

    expect(state.activePlayerId).toBe(state.turnOrder[2]);
    expect(state.activePlayerId).not.toBe(offline);
  });

  it("重新开局保留四名玩家及名字，但重新决定行动顺序", () => {
    const state = createInitialGame(
      1,
      { player1: "甲", player2: "乙", player3: "丙", player4: "丁" },
      FOUR_PLAYERS,
    );
    const restarted = gameReducer(state, { type: "restart", seed: 2 });

    expect(Object.keys(restarted.players)).toEqual([...FOUR_PLAYERS]);
    expect(FOUR_PLAYERS.map((id) => restarted.players[id].name)).toEqual(["甲", "乙", "丙", "丁"]);
    expect(restarted.turnOrder).toHaveLength(4);
  });

  it("行动玩家掉线超时后自动跳过，房间不会永久卡住", () => {
    const state = createInitialGame(77, {}, FOUR_PLAYERS);
    const timedOut = state.activePlayerId;
    state.unavailablePlayerIds = [timedOut];

    const next = handleDisconnectTimeout(state, timedOut);

    expect(next).not.toBe(state);
    expect(next.activePlayerId).not.toBe(timedOut);
    expect(next.phase.kind).toBe("awaitingRoll");
    expect(next.history.some((entry) => entry.text.includes("掉线超时"))).toBe(true);
  });

  it("奖励确认阶段获奖玩家掉线后自动确认并轮转", () => {
    const state = createInitialGame(78, {}, FOUR_PLAYERS);
    const timedOut = state.activePlayerId;
    state.unavailablePlayerIds = [timedOut];
    state.phase = {
      kind: "pveReward",
      notice: {
        playerId: timedOut,
        enemyName: "狂暴的山狼",
        elite: true,
        rewards: [{
          source: "elite",
          resourceType: "scroll",
          name: "力量卷轴",
          publicName: "一张卷轴",
        }],
      },
    };

    const next = handleDisconnectTimeout(state, timedOut);

    expect(next.phase.kind).toBe("awaitingRoll");
    expect(next.activePlayerId).not.toBe(timedOut);
  });

  it("PvP 参与者掉线超时按战败处理，但不再后退", () => {
    const state = createInitialGame(88, {}, ["player1", "player2", "player3"]);
    const timedOut = state.activePlayerId;
    const opponent = state.turnOrder.find((id) => id !== timedOut)!;
    state.players[timedOut].position = 20;
    state.players[opponent].position = 20;
    state.unavailablePlayerIds = [timedOut];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: timedOut, bPlayerId: opponent }),
    };

    const next = handleDisconnectTimeout(state, timedOut);

    expect(next.phase.kind).not.toBe("battle");
    expect(next.players[timedOut].position).toBe(20);
    expect(next.activePlayerId).not.toBe(timedOut);
  });
});
