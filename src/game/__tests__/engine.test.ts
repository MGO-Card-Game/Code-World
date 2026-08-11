import { describe, expect, it } from "vitest";
import { REWARD_RARITY_TIERS } from "../content/rarity";
import { createInitialGame, gameReducer } from "../engine";
import {
  advanceAutomatically,
  makeBattle,
  PLAYTHROUGH_CAP,
  PLAYTHROUGH_SEED,
  resolveRound,
} from "../testSupport";
import { EQUIPMENT, EQUIPMENT_SLOT_LIMITS, equipmentCategory } from "../content/equipment";
import type { GameState } from "../types";

describe("game engine", () => {
  it("accepts player names and preserves them when restarting", () => {
    let state = createInitialGame(20260806, {
      player1: "云雀",
      player2: "长风",
    });

    expect(state.players.player1.name).toBe("云雀");
    expect(state.players.player2.name).toBe("长风");

    state = gameReducer(state, { type: "restart", seed: 42 });

    expect(state.players.player1.name).toBe("云雀");
    expect(state.players.player2.name).toBe("长风");
  });

  it("复用只读地图，同时隔离会变化的对局状态", () => {
    const state = createInitialGame(20260805);
    const actor = state.activePlayerId;
    const positionBefore = state.players[actor].position;

    const next = gameReducer(state, { type: "rollMovement" });

    expect(next).not.toBe(state);
    expect(next.map).toBe(state.map);
    expect(next.players).not.toBe(state.players);
    expect(next.players[actor]).not.toBe(state.players[actor]);
    expect(state.players[actor].position).toBe(positionBefore);
  });

  it("replays deterministically from the same seed", () => {
    let first = createInitialGame(20260805);
    let second = createInitialGame(20260805);

    for (let step = 0; step < 80; step += 1) {
      first = advanceAutomatically(first);
      second = advanceAutomatically(second);
    }

    expect(second).toEqual(first);
  });

  it("非 Boss 战的卷轴和装备奖励各有 50% 概率，不受怪物种类影响", () => {
    for (const enemyId of ["slime", "golem"] as const) {
      const outcomes = new Set<"scroll" | "equipment">();

      for (let seed = 1; seed <= 100 && outcomes.size < 2; seed += 1) {
        let state = createInitialGame(seed);
        state.players.player1.baseAttack = 99;
        state.phase = {
          kind: "battle",
          battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId, hpB: 1 }),
        };

        state = resolveRound(state);
        outcomes.add(state.players.player1.scrolls.length > 0 ? "scroll" : "equipment");
      }

      expect(outcomes).toEqual(new Set(["scroll", "equipment"]));
    }
  });

  it("普通怪基础装备走 basic 档 80/15/5/0，不会掉落 PR", () => {
    expect(REWARD_RARITY_TIERS.basic)
      .toEqual({ N: 80, R: 15, SR: 5, PR: 0 });
    const observed = new Set<string>();

    for (let seed = 1; seed <= 400; seed += 1) {
      let state = createInitialGame(seed);
      state.players.player1.baseAttack = 99;
      state.phase = {
        kind: "battle",
        battle: makeBattle({ kind: "pve", aPlayerId: "player1", enemyId: "slime", hpB: 1 }),
      };

      state = resolveRound(state);
      const equipment = state.players.player1.equipment[0];
      if (equipment) observed.add(EQUIPMENT[equipment.kind].rarity);
    }

    expect(observed).toEqual(new Set(["N", "R", "SR"]));
    expect(observed.has("PR")).toBe(false);
  });

  it("精英胜利在基础奖励外必定追加一张卷轴，并等待玩家确认", () => {
    let state = createInitialGame(20260807);
    const player = state.players.player1;
    player.baseAttack = 99;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: player.id,
        enemyId: "razorbackAlpha",
        hpB: 1,
      }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).toBe("pveReward");
    if (state.phase.kind !== "pveReward") throw new Error("应显示战斗奖励");
    expect(state.phase.notice.elite).toBe(true);
    expect(state.phase.notice.rewards.map((reward) => reward.source))
      .toEqual(["battle", "battle", "elite", "elite"]);
    expect(state.phase.notice.rewards[2].resourceType).toBe("scroll");
    expect(state.phase.notice.rewards.filter((reward) => reward.resourceType === "gold"))
      .toHaveLength(2);
    expect(state.players[player.id].scrolls)
      .toHaveLength(1 + Number(state.phase.notice.rewards[0].resourceType === "scroll"));

    state = gameReducer(state, { type: "acknowledgePveReward" });
    expect(state.phase.kind).toBe("turnComplete");
  });

  it("精英基础装备奖励需要替换时，完成选择后再显示完整奖励", () => {
    let resolved: GameState | undefined;
    for (let seed = 1; seed <= 100 && !resolved; seed += 1) {
      let state = createInitialGame(seed);
      const player = state.players.player1;
      player.baseAttack = 99;
      player.equipment = [
        { instanceId: "weapon-full", kind: "sword" },
        { instanceId: "armor-full", kind: "shield" },
        { instanceId: "shoes-full", kind: "travelerBoots" },
        { instanceId: "accessory-full-1", kind: "charm" },
        { instanceId: "accessory-full-2", kind: "fateCrown" },
      ];
      state.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: "pve",
          aPlayerId: player.id,
          enemyId: "razorbackAlpha",
          hpB: 1,
        }),
      };
      state = resolveRound(state);
      if (state.phase.kind === "equipmentChoice") resolved = state;
    }

    if (!resolved || resolved.phase.kind !== "equipmentChoice") {
      throw new Error("100 个种子内应抽到一件装备奖励");
    }
    expect(resolved.phase.choice.resume.kind).toBe("showPveReward");

    resolved = gameReducer(resolved, { type: "chooseEquipment" });
    expect(resolved.phase.kind).toBe("pveReward");
    if (resolved.phase.kind !== "pveReward") throw new Error("应在装备选择后显示奖励");
    expect(resolved.phase.notice.rewards).toHaveLength(4);
  });

  it("词条漫游怪获得小额词条奖励，但不冒充独立精英怪", () => {
    let state = createInitialGame(20260807);
    const player = state.players.player1;
    player.baseAttack = 99;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: player.id,
        enemyId: "slime",
        enemyAffix: "honed",
        hpB: 1,
      }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).toBe("pveReward");
    if (state.phase.kind !== "pveReward") throw new Error("应显示战斗奖励");
    expect(state.phase.notice.elite).toBe(false);
    expect(state.phase.notice.rewards.map((reward) => reward.source))
      .toEqual(["battle", "battle", "affix"]);
    expect(state.phase.notice.rewards.find((reward) => reward.source === "affix"))
      .toMatchObject({ resourceType: "gold", name: "10 金币" });
  });

  it("keeps core state inside valid bounds during a full automated game", () => {
    let state = createInitialGame(PLAYTHROUGH_SEED);

    for (let step = 0; step < PLAYTHROUGH_CAP && state.phase.kind !== "gameOver"; step += 1) {
      state = advanceAutomatically(state);
      for (const player of Object.values(state.players)) {
        expect(player.position).toBeGreaterThanOrEqual(0);
        expect(player.position).toBeLessThan(state.map.tiles.length);
        expect(player.hp).toBeGreaterThanOrEqual(1);
        expect(player.hp).toBeLessThanOrEqual(player.maxHp);
        for (const [category, limit] of Object.entries(EQUIPMENT_SLOT_LIMITS)) {
          expect(player.equipment.filter(
            (item) => equipmentCategory(item.kind) === category,
          ).length).toBeLessThanOrEqual(limit);
        }
      }
    }
    // 超时只作为保险丝：步数会随内容改动上下大幅波动，逐步断言的开销都在这里。
  }, 30_000);

  it("装备槽满时只允许替换同类装备，也可以放弃新装备", () => {
    let state = createInitialGame(77);
    state.players.player1.equipment = [
      { instanceId: "shield-old", kind: "shield" },
    ];
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "leather-new", kind: "borderLeather" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };

    state = gameReducer(state, {
      type: "chooseEquipment",
      replaceInstanceId: "shield-old",
    });
    expect(state.phase.kind).toBe("turnComplete");
    expect(state.players.player1.equipment).toEqual([
      { instanceId: "leather-new", kind: "borderLeather" },
    ]);

    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "leather-discard", kind: "borderLeather" },
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };
    state = gameReducer(state, { type: "chooseEquipment" });
    expect(state.players.player1.equipment.map((item) => item.instanceId))
      .toEqual(["leather-new"]);
  });

  it("装备选择完成后，resolveTile 那条 resume 会真的回去结算那一格", () => {
    // 相遇战败方交出装备、赢家槽位已满时走的就是这条 resume：
    // 选完装备还欠一次格子结算，漏掉的话踩中的宝箱会被静默跳过
    const state = createInitialGame(78);
    const treasure = state.map.tiles.find(
      (tile) => tile.region === "foothill" && tile.type === "treasure",
    )!;
    state.activePlayerId = "player1";
    state.players.player1.position = treasure.id;
    state.players.player1.equipment = [{ instanceId: "shield-old", kind: "shield" }];
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: "player1",
        offered: { instanceId: "leather-looted", kind: "borderLeather" },
        source: "transfer",
        resume: { kind: "resolveTile", tileIndex: treasure.id },
      },
    };

    const resolved = gameReducer(state, { type: "chooseEquipment" });

    // 宝箱被记为已开、金币到账，才说明这一格确实结算过了
    expect(resolved.players.player1.stageProgress.foothill.openedTreasureTileIds)
      .toContain(treasure.id);
    expect(resolved.players.player1.gold).toBeGreaterThan(0);
  });

  it("旅行者短靴把移动骰从 D6 提高到 D7", () => {
    let state = createInitialGame(123);
    state.players[state.activePlayerId].equipment = [
      { instanceId: "boots-1", kind: "travelerBoots" },
    ];

    state = gameReducer(state, { type: "rollMovement" });
    const movement = state.lastEvents.find((event) => event.type === "movementRolled");
    if (movement?.type !== "movementRolled") throw new Error("应产生移动投骰事件");
    expect(movement.sides).toBe(7);
    expect(movement.value).toBeLessThanOrEqual(7);
  });

  it("restores real player health after a PvP battle", () => {
    let state = createInitialGame(42);
    state.players.player1.hp = 11;
    state.players.player2.hp = 15;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
        hpA: 11,
        hpB: 15,
        initiativeB: 2,
      }),
    };

    for (let step = 0; step < 100 && state.phase.kind === "battle"; step += 1) {
      state = resolveRound(state);
    }

    expect(state.phase.kind).toBe("pvpPenalty");
    expect(state.players.player1.hp).toBe(11);
    expect(state.players.player2.hp).toBe(15);
  });

  it("deals zero damage when defense is higher than attack", () => {
    let state = createInitialGame(7);
    state.players.player2.baseDefense = 100;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: "player1",
        bPlayerId: "player2",
      }),
    };

    state = resolveRound(state);

    expect(state.phase.kind).toBe("battle");
    if (state.phase.kind === "battle") {
      expect(state.phase.battle.hpB).toBe(18);
      expect(state.phase.battle.log[0]).toContain("受到 0 点伤害");
    }
  });
});
