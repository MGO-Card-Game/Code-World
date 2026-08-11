import { describe, expect, it } from "vitest";
import { finishBattle } from "../battle";
import { bossKeyPrice } from "../economy";
import { createInitialGame, gameReducer } from "../engine";
import { canAct } from "../multiplayer";
import { makeBattle, resolveRound } from "../testSupport";

describe("循环阶段地图", () => {
  it("未满两圈时绕过守关门并累计圈数", () => {
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

  it("经过阶段营地就回满生命，不需要正好停在营地上", () => {
    let state = createInitialGame(110);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    // 从守关门前一格起步：守关门在前、营地紧随其后，这个种子的骰点足以越过两者
    player.position = region.endIndex;
    player.hp = 4;

    state = gameReducer(state, { type: "rollMovement" });
    const moved = state.players[player.id];

    expect(state.lastMovementRoll).toBeGreaterThan(2);
    expect(moved.position).not.toBe(region.entryIndex);
    expect(moved.hp).toBe(moved.maxHp);
    expect(state.lastEvents).toContainEqual(expect.objectContaining({
      type: "playerHpChanged",
      playerId: player.id,
      from: 4,
      to: moved.maxHp,
      reason: "camp",
    }));
  });

  it("没有经过营地的移动不会回血", () => {
    let state = createInitialGame(107);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    // 营地在守关门之后；从营地起步，一次掷骰绕不回去
    player.position = region.entryIndex;
    player.hp = 4;

    state = gameReducer(state, { type: "rollMovement" });

    expect(state.players[player.id].position).not.toBe(region.entryIndex);
    expect(state.lastEvents.filter(
      (event) => event.type === "playerHpChanged" && event.reason === "camp",
    )).toHaveLength(0);
  });

  it("每次精英格胜利都计入阶段目标，重复击败同一格也会计数", () => {
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
          enemyId: "razorbackAlpha",
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

    expect(state.players[player.id].stageProgress.foothill.eliteVictories).toBe(2);
  });

  it("完成条件后经过守关门会截停，购买钥匙后才能挑战", () => {
    let state = createInitialGame(103);
    const player = state.players[state.activePlayerId];
    const region = state.map.regions[0];
    player.position = region.endIndex;
    player.stageProgress.foothill.laps = 1;

    state = gameReducer(state, { type: "rollMovement" });

    expect(state.lastMovementRoll).toBeGreaterThan(1);
    expect(state.phase.kind).toBe("bossGateChoice");
    expect(state.players[player.id].position).toBe(region.gateIndex);
    expect(canAct(state, { type: "chooseBossChallenge", challenge: true }, player.id)).toBe(true);
    const other = player.id === "player1" ? "player2" : "player1";
    expect(canAct(state, { type: "chooseBossChallenge", challenge: true }, other)).toBe(false);

    expect(gameReducer(state, { type: "chooseBossChallenge", challenge: true })).toBe(state);
    expect(gameReducer(state, { type: "buyBossKey" })).toBe(state);
    state.players[player.id].gold = bossKeyPrice(state.map, region.id);
    state = gameReducer(state, { type: "buyBossKey" });
    expect(state.players[player.id].gold).toBe(0);
    expect(state.players[player.id].stageProgress.foothill.bossKeyPurchased).toBe(true);
    expect(state.phase.kind).toBe("bossGateChoice");
    expect(state.lastEvents).toContainEqual(expect.objectContaining({
      type: "goldChanged",
      playerId: player.id,
      from: 100,
      to: 0,
      reason: "bossKey",
    }));

    state = gameReducer(state, { type: "chooseBossChallenge", challenge: true });
    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind !== "battle") throw new Error("应进入首领战");
    expect(state.phase.battle.kind).toBe("boss");
    expect(state.phase.battle.enemyId).toBe("banditChief");
    expect(state.phase.battle.enemyAffix).toBeUndefined();
    expect(state.phase.battle.stageId).toBe("foothill");
  });

  it("第二阶段绕满三圈后经过守关门会截停", () => {
    let state = createInitialGame(112);
    const player = state.players[state.activePlayerId];
    const mountainside = state.map.regions[1];
    player.position = mountainside.endIndex;
    player.stageProgress.mountainside.laps = 2;

    state = gameReducer(state, { type: "rollMovement" });

    expect(mountainside.requirements).toEqual([
      { type: "laps", target: 3, label: "绕场 3 圈" },
    ]);
    expect(state.players[player.id].stageProgress.mountainside.laps).toBe(3);
    expect(state.players[player.id].stageProgress.mountainside.eliteVictories).toBe(0);
    expect(state.players[player.id].position).toBe(mountainside.gateIndex);
    expect(state.phase.kind).toBe("bossGateChoice");
  });

  it("阶段钥匙按阶段定价，购买后可以暂不进入且钥匙不会丢失", () => {
    let state = createInitialGame(106);
    const player = state.players[state.activePlayerId];
    const [foothill, mountainside, summit] = state.map.regions;
    expect([
      bossKeyPrice(state.map, foothill.id),
      bossKeyPrice(state.map, mountainside.id),
      bossKeyPrice(state.map, summit.id),
    ]).toEqual([100, 200, 300]);

    player.position = foothill.gateIndex;
    player.stageProgress.foothill.laps = 2;
    player.gold = 100;
    state.phase = {
      kind: "bossGateChoice",
      choice: {
        playerId: player.id,
        stageId: foothill.id,
        gateTileIndex: foothill.gateIndex,
        bossEnemyId: foothill.bossEnemyId,
      },
    };

    expect(canAct(state, { type: "buyBossKey" }, player.id)).toBe(true);
    const other = player.id === "player1" ? "player2" : "player1";
    expect(canAct(state, { type: "buyBossKey" }, other)).toBe(false);
    state = gameReducer(state, { type: "buyBossKey" });
    state = gameReducer(state, { type: "chooseBossChallenge", challenge: false });

    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players[player.id].stageProgress.foothill.bossKeyPurchased).toBe(true);
    expect(state.players[player.id].gold).toBe(0);
  });

  it("第三阶段无需完成阶段任务，只需 300 金币购买钥匙", () => {
    let state = createInitialGame(111);
    const player = state.players[state.activePlayerId];
    const summit = state.map.regions[2];
    player.position = summit.endIndex;
    player.gold = 300;

    state = gameReducer(state, { type: "rollMovement" });

    expect(summit.requirements).toEqual([]);
    expect(state.players[player.id].stageProgress.summit.eliteVictories).toBe(0);
    expect(state.phase.kind).toBe("bossGateChoice");
    expect(state.players[player.id].position).toBe(summit.gateIndex);

    state = gameReducer(state, { type: "buyBossKey" });

    expect(state.players[player.id].gold).toBe(0);
    expect(state.players[player.id].stageProgress.summit.bossKeyPurchased).toBe(true);
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
    player.hp = 1;
    finishBattle(state, firstBoss, "a");

    expect(player.stageProgress.foothill.bossDefeated).toBe(true);
    expect(player.position).toBe(mountainside.entryIndex);
    // 落点就是云腰营地，残血通关不该带着 1 点血进下一阶段
    expect(player.hp).toBe(player.maxHp);
    // 阶段首领会发奖励，弹层要由本人确认，不能直接回到 turnComplete
    expect(state.phase.kind).toBe("pveReward");
    state.phase = { kind: "turnComplete" };

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

  it("阶段首领战败返回本阶段营地，解锁进度不会丢失", () => {
    const state = createInitialGame(105);
    const player = state.players.player1;
    const region = state.map.regions[0];
    player.position = region.gateIndex;
    player.stageProgress.foothill.laps = 2;
    const battle = makeBattle({
      kind: "boss",
      aPlayerId: player.id,
      enemyId: region.bossEnemyId,
      stageId: region.id,
    });

    finishBattle(state, battle, "b");

    expect(player.position).toBe(region.entryIndex);
    expect(player.stageProgress.foothill.laps).toBe(2);
  });
});
