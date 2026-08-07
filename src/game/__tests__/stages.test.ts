import { describe, expect, it } from "vitest";
import { finishBattle } from "../battle";
import { createInitialGame, gameReducer } from "../engine";
import { canAct } from "../multiplayer";
import { makeBattle, resolveRound } from "../testSupport";

describe("循环阶段地图", () => {
  it("未完成条件时绕过守关门并累计圈数", () => {
    let state = createInitialGame(101);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    player.position = region.endIndex;

    state = gameReducer(state, { type: "rollMovement" });

    expect(player.stageProgress.foothill.laps).toBe(0); // reducer 不修改旧对象
    expect(state.players[player.id].stageProgress.foothill.laps).toBe(1);
    expect(state.phase.kind).not.toBe("bossGateChoice");
    expect(state.map.tiles[state.players[player.id].position].region).toBe("foothill");
  });

  it("精英格首次胜利计入阶段目标，重复击败同一格不重复计数", () => {
    let state = createInitialGame(102);
    const player = state.players.player1;
    const tile = state.map.tiles.find(
      (candidate) => candidate.region === "foothill" && candidate.type === "elite",
    )!;
    player.baseAttack = 99;

    const winElite = () => {
      state.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: "pve",
          aPlayerId: player.id,
          enemyId: tile.enemyId,
          enemyAffix: tile.eliteAffix,
          stageId: tile.region,
          tileIndex: tile.id,
          hpB: 1,
        }),
      };
      state = resolveRound(state);
      if (state.phase.kind === "pveReward") {
        state = gameReducer(state, { type: "acknowledgePveReward" });
      }
    };

    winElite();
    winElite();

    expect(state.players[player.id].stageProgress.foothill.defeatedEliteTileIds)
      .toEqual([tile.id]);
  });

  it("完成条件后即使骰点有剩余，经过守关门也会截停并由本人决定是否挑战", () => {
    let state = createInitialGame(103);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    player.position = region.endIndex;
    player.stageProgress.foothill.defeatedEliteTileIds = [
      state.map.tiles.find((tile) => tile.region === "foothill" && tile.type === "elite")!.id,
    ];

    state = gameReducer(state, { type: "rollMovement" });

    expect(state.lastMovementRoll).toBeGreaterThan(1);
    expect(state.phase.kind).toBe("bossGateChoice");
    expect(state.players[player.id].position).toBe(region.gateIndex);
    expect(canAct(state, { type: "chooseBossChallenge", challenge: true }, player.id)).toBe(true);
    const other = player.id === "player1" ? "player2" : "player1";
    expect(canAct(state, { type: "chooseBossChallenge", challenge: true }, other)).toBe(false);

    state = gameReducer(state, { type: "chooseBossChallenge", challenge: true });
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind !== "battle") throw new Error("应进入首领战");
    expect(state.phase.battle.kind).toBe("boss");
    expect(state.phase.battle.enemyId).toBe("banditChief");
    expect(state.phase.battle.stageId).toBe("foothill");
  });

  it("击败前两阶段首领进入下一环，击败巨龙结束游戏", () => {
    const state = createInitialGame(104);
    const player = state.players.player1;
    const foothill = state.map.regions[0];
    const mountainside = state.map.regions[1];

    const firstBoss = makeBattle({
      kind: "boss",
      aPlayerId: player.id,
      enemyId: foothill.bossEnemyId,
      stageId: foothill.id,
      tileIndex: foothill.gateIndex,
    });
    finishBattle(state, firstBoss, "a");

    expect(player.stageProgress.foothill.bossDefeated).toBe(true);
    expect(player.position).toBe(mountainside.entryIndex);
    expect(player.checkpointTileId).toBe(mountainside.entryIndex);
    expect(state.phase.kind).toBe("turnComplete");

    const summit = state.map.regions[2];
    const finalBoss = makeBattle({
      kind: "boss",
      aPlayerId: player.id,
      enemyId: summit.bossEnemyId,
      stageId: summit.id,
      tileIndex: summit.gateIndex,
    });
    finishBattle(state, finalBoss, "a");

    expect(state.phase).toEqual({ kind: "gameOver", winnerId: player.id });
  });

  it("阶段首领战败返回本阶段检查点，解锁进度不会丢失", () => {
    const state = createInitialGame(105);
    const player = state.players.player1;
    const region = state.map.regions[0];
    const eliteId = state.map.tiles.find(
      (tile) => tile.region === region.id && tile.type === "elite",
    )!.id;
    player.position = region.gateIndex;
    player.checkpointTileId = region.entryIndex;
    player.stageProgress.foothill.defeatedEliteTileIds = [eliteId];
    const battle = makeBattle({
      kind: "boss",
      aPlayerId: player.id,
      enemyId: region.bossEnemyId,
      stageId: region.id,
      retreatTo: player.checkpointTileId,
    });

    finishBattle(state, battle, "b");

    expect(player.position).toBe(region.entryIndex);
    expect(player.stageProgress.foothill.defeatedEliteTileIds).toEqual([eliteId]);
  });
});
