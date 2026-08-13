import { describe, expect, it } from "vitest";
import { finishBattle, finishPvp } from "../../battle";
import {
  acceptDrawnBlessing,
  applyBlessingCombatRoll,
  blessingCapacity,
  blessingMovementRollBonus,
  detachBlessing,
  grantRandomBlessing,
} from "../../blessings";
import {
  BLESSINGS,
  blessingDefinition,
  pickBlessingKind,
  type BlessingKind,
} from "../../content/blessings";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { canAct, currentActor } from "../../multiplayer";
import { getAttack, getDefense } from "../../selectors";
import { makeBattle, resolveRound } from "../../testSupport";
import { newRollModifiers } from "../../battleRound";
import type { GameState, Player } from "../../types";

function giveBlessing(player: Player, kind: BlessingKind, instanceId = `test-${kind}`) {
  player.blessings = [{ instanceId, kind }];
  return player.blessings[0];
}

function reachBlessingChoice() {
  const state = createInitialGame(77);
  const loser = state.players.player1;
  const winner = state.players.player2;
  // 这组用例要测的是“赐福覆盖选择完就直接回到 turnComplete”，代价必须免除；
  // 玩家现在开局自带金币，得手动清零才能保住“败方一无所有”这个前提。
  loser.gold = 0;
  const offered = giveBlessing(loser, "giantStrength", "loser-blessing");
  giveBlessing(winner, "dragonScale", "winner-blessing");
  finishPvp(state, makeBattle({
    kind: "pvp",
    aPlayerId: loser.id,
    bPlayerId: winner.id,
  }), "b");
  return { state, loser, winner, offered };
}

function forceLandingOn(state: GameState, type: "blessing" | "treasure") {
  const player = state.players[state.activePlayerId];
  const opponent = Object.values(state.players).find(({ id }) => id !== player.id)!;
  player.position = 10;
  opponent.position = 0;
  const preview = gameReducer(state, { type: "rollMovement" });
  const movement = preview.lastEvents.find((event) => event.type === "movementRolled");
  if (movement?.type !== "movementRolled") throw new Error("应该产生移动投骰事件");
  const target = state.map.tiles[player.position + movement.value];
  target.type = type;
  target.safeZone = false;
  delete target.enemyId;
  delete target.eliteAffix;
  return gameReducer(state, { type: "rollMovement" });
}

describe("赐福内容", () => {
  it("登记并启用了 buff.md 中的八种赐福", () => {
    expect(Object.keys(BLESSINGS)).toEqual([
      "giantStrength",
      "dragonScale",
      "ancientTreeHeart",
      "favoredByFate",
      "windrunner",
      "warTycoon",
      "treasureHunter",
      "unyieldingWill",
      "midasTouch",
    ]);
    expect(BLESSINGS.midasTouch.enabled).toBe(true);
    const picked = new Set(
      Array.from({ length: 800 }, (_, ticket) => pickBlessingKind(() => ticket / 800)),
    );
    expect(picked).toContain("midasTouch");
  });

  it("巨人之力与龙鳞护体分别提供 2 点攻击和防御", () => {
    const state = createInitialGame(1);
    giveBlessing(state.players.player1, "giantStrength");
    giveBlessing(state.players.player2, "dragonScale");

    // 基础 攻 5 / 防 2，各加 2
    expect(getAttack(state.players.player1)).toBe(7);
    expect(getDefense(state.players.player2)).toBe(4);
  });

  it("古树之心提高生命上限，获得时回血，失去时扣回", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;
    const maxHpBefore = player.maxHp;
    const bonus = BLESSINGS.ancientTreeHeart.modifiers
      .filter((modifier) => modifier.type === "maxHp")
      .reduce((sum, modifier) => sum + modifier.value, 0);
    player.hp = maxHpBefore - 5;
    const blessing = {
      instanceId: "ancient-tree-heart",
      kind: "ancientTreeHeart" as const,
    };

    expect(acceptDrawnBlessing(state, player, blessing)).toBe(true);
    expect(player.maxHp).toBe(maxHpBefore + bonus);
    expect(player.hp).toBe(maxHpBefore - 5 + bonus);

    expect(detachBlessing(state, player, blessing.instanceId)).toEqual(blessing);
    expect(player.maxHp).toBe(maxHpBefore);
    expect(player.hp).toBe(maxHpBefore);
  });

  it("命运垂青把攻防骰最低点数提高到 3", () => {
    const state = createInitialGame(2);
    const player = state.players.player1;
    giveBlessing(player, "favoredByFate");
    const modifiers = newRollModifiers();

    applyBlessingCombatRoll(player, modifiers);

    expect(modifiers.minimumRoll).toBe(3);
  });

  it("逐风者让同一随机流的移动结果增加 1", () => {
    const normal = createInitialGame(3);
    const blessed = createInitialGame(3);
    giveBlessing(blessed.players[blessed.activePlayerId], "windrunner");

    const normalMoved = gameReducer(normal, { type: "rollMovement" });
    const blessedMoved = gameReducer(blessed, { type: "rollMovement" });
    const normalRoll = normalMoved.lastEvents.find((event) => event.type === "movementRolled");
    const blessedRoll = blessedMoved.lastEvents.find((event) => event.type === "movementRolled");

    expect(blessingMovementRollBonus(blessed.players[blessed.activePlayerId])).toBe(1);
    expect(blessedRoll?.type === "movementRolled" ? blessedRoll.value : 0)
      .toBe((normalRoll?.type === "movementRolled" ? normalRoll.value : 0) + 1);
  });

  it("战争财阀在非 Boss PvE 胜利后额外发一张卷轴", () => {
    const state = createInitialGame(4);
    const player = state.players.player1;
    giveBlessing(player, "warTycoon");
    player.baseAttack = 99;
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pve", aPlayerId: player.id, enemyId: "slime", hpB: 1 }),
    };

    const resolved = resolveRound(state);

    expect(resolved.players[player.id].scrolls.length).toBeGreaterThanOrEqual(1);
    expect(resolved.message.text).toContain("战争财阀额外获得");
  });

  /**
   * 宝箱有空箱档，空箱不触发宝物猎人。逐个种子找到一次真的开出东西的开箱，
   * 断言才不会被那 30% 的空箱概率变成偶尔翻红的脆弱测试。
   */
  function forceTreasureHaul(makeState: () => GameState) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const resolved = forceLandingOn(makeState(), "treasure");
      const emptied = resolved.history.some(
        (entry) => entry.text.includes("什么都没剩下"),
      );
      if (!emptied) return resolved;
    }
    throw new Error("连续 100 次都开出空箱，权重表可能配错了");
  }

  it("宝物猎人开启宝箱时额外获得一件装备", () => {
    let seed = 5;
    const resolved = forceTreasureHaul(() => {
      const state = createInitialGame(seed++);
      giveBlessing(state.players[state.activePlayerId], "treasureHunter");
      return state;
    });
    const player = resolved.players[resolved.activePlayerId];

    expect(player.equipment.length).toBeGreaterThanOrEqual(1);
    expect(resolved.history.some((entry) => entry.text.includes("宝物猎人额外获得"))).toBe(true);
  });

  it("宝物猎人的额外装备在槽满时进入替换或放弃流程", () => {
    let seed = 51;
    let resolved = forceTreasureHaul(() => {
      const state = createInitialGame(seed++);
      const player = state.players[state.activePlayerId];
      giveBlessing(player, "treasureHunter");
      player.equipment = [
        { instanceId: "weapon-full", kind: "sword" },
        { instanceId: "armor-full", kind: "shield" },
        { instanceId: "shoes-full", kind: "travelerBoots" },
        { instanceId: "accessory-full-1", kind: "charm" },
        { instanceId: "accessory-full-2", kind: "fateCrown" },
      ];
      return state;
    });

    let choices = 0;
    while (resolved.phase.kind === "equipmentChoice") {
      choices += 1;
      resolved = gameReducer(resolved, { type: "chooseEquipment" });
    }

    expect(choices).toBeGreaterThanOrEqual(1);
    expect(resolved.phase.kind).toBe("treasureReward");
    if (resolved.phase.kind !== "treasureReward") throw new Error("应进入宝箱结果弹窗");
    expect(resolved.phase.notice.rewards.some((reward) => reward.source === "blessing")).toBe(true);
    resolved = gameReducer(resolved, { type: "acknowledgeTreasureReward" });
    expect(resolved.phase.kind).toBe("turnComplete");
    expect(resolved.history.some((entry) => entry.text.includes("宝物猎人额外获得"))).toBe(true);
  });

  it("不屈意志让战败留在原地，未持有时退回阶段营地", () => {
    const region = createInitialGame(6).map.regions[0];
    const spot = region.startIndex + 13;
    const defeatAt = (kind: "pve" | "boss", blessed: boolean) => {
      const state = createInitialGame(6);
      const player = state.players.player1;
      player.position = spot;
      player.hp = 1;
      if (blessed) giveBlessing(player, "unyieldingWill");
      finishBattle(state, makeBattle({
        kind,
        aPlayerId: player.id,
        enemyId: kind === "boss" ? region.bossEnemyId : "golem",
        stageId: region.id,
      }), "b");
      return player;
    };

    // 半血复活是两条路共有的，区别只在落点
    for (const kind of ["pve", "boss"] as const) {
      const blessed = defeatAt(kind, true);
      expect(blessed.position).toBe(spot);
      expect(blessed.hp).toBe(Math.ceil(blessed.maxHp / 2));

      const bare = defeatAt(kind, false);
      expect(bare.position).toBe(region.entryIndex);
      expect(bare.hp).toBe(Math.ceil(bare.maxHp / 2));
    }
  });

  it("不屈意志不再免除相遇战代价", () => {
    const state = createInitialGame(78);
    const loser = state.players.player1;
    const winner = state.players.player2;
    loser.hp = 10;
    loser.gold = 100;
    giveBlessing(loser, "unyieldingWill");

    finishPvp(state, makeBattle({
      kind: "pvp",
      aPlayerId: loser.id,
      bPlayerId: winner.id,
    }), "b");

    expect(loser.hp).toBe(10);
    if (state.phase.kind !== "pvpPenalty") throw new Error("应进入代价阶段");
    expect(state.phase.penalty.waived).toBeUndefined();
    expect(winner.blessings[0].kind).toBe("unyieldingWill");
  });
});

describe("赐福持有与 PvP 覆盖", () => {
  it("赐福格随机授予一个已启用赐福", () => {
    const state = createInitialGame(42);
    const player = state.players.player1;

    const blessing = grantRandomBlessing(state, player);

    expect(blessing).toBeDefined();
    expect(blessingDefinition(blessing!.kind).enabled).not.toBe(false);
    expect(player.blessings).toEqual([blessing]);
    expect(state.lastEvents.some((event) => event.type === "blessingGranted")).toBe(true);
  });

  it("玩家已有赐福时不能再次获得或叠加", () => {
    const state = createInitialGame(43);
    const player = state.players.player1;
    const first = grantRandomBlessing(state, player);
    const second = grantRandomBlessing(state, player);

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(player.blessings).toEqual([first]);
  });

  it("每击败一个阶段首领，赐福持有上限增加 1", () => {
    const state = createInitialGame(44);
    const player = state.players.player1;

    expect(blessingCapacity(player)).toBe(1);
    player.stageProgress.foothill.bossDefeated = true;
    expect(blessingCapacity(player)).toBe(2);

    const first = grantRandomBlessing(state, player);
    const second = grantRandomBlessing(state, player);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.kind).not.toBe(first!.kind);
    expect(grantRandomBlessing(state, player)).toBeUndefined();

    player.stageProgress.mountainside.bossDefeated = true;
    expect(blessingCapacity(player)).toBe(3);
    expect(grantRandomBlessing(state, player)).toBeDefined();
    expect(player.blessings).toHaveLength(3);
  });

  it("同时持有的多个赐福都会生效", () => {
    const state = createInitialGame(45);
    const player = state.players.player1;
    player.blessings = [
      { instanceId: "strength", kind: "giantStrength" },
      { instanceId: "wind", kind: "windrunner" },
    ];

    expect(getAttack(player)).toBe(7);
    expect(blessingMovementRollBonus(player)).toBe(1);
  });

  it("停在赐福格时自动抽取，不进入额外选择阶段", () => {
    const state = createInitialGame(123);
    const playerId = state.activePlayerId;

    const resolved = forceLandingOn(state, "blessing");

    expect(resolved.phase.kind).toBe("blessingReward");
    if (resolved.phase.kind !== "blessingReward") throw new Error("应进入赐福获得弹窗");
    expect(resolved.phase.notice.blessing).toEqual(resolved.players[playerId].blessings[0]);
    expect(resolved.players[playerId].blessings).toHaveLength(1);
    expect(resolved.message.text).toContain("获得永久赐福");
  });

  it("击败首领解锁空槽后，再踩赐福格会直接获得第二个赐福", () => {
    const state = createInitialGame(126);
    const playerId = state.activePlayerId;
    const player = state.players[playerId];
    giveBlessing(player, "giantStrength", "first-blessing");
    player.stageProgress.foothill.bossDefeated = true;

    const resolved = forceLandingOn(state, "blessing");

    expect(resolved.phase.kind).toBe("blessingReward");
    if (resolved.phase.kind !== "blessingReward") throw new Error("应进入赐福获得弹窗");
    expect(resolved.phase.notice.blessing).toEqual(resolved.players[playerId].blessings[1]);
    expect(resolved.players[playerId].blessings).toHaveLength(2);
    expect(resolved.players[playerId].blessings.map((blessing) => blessing.kind))
      .toContain("giantStrength");
  });

  it("多个赐福满槽时可以指定要替换的赐福", () => {
    const state = createInitialGame(127);
    const playerId = state.activePlayerId;
    const player = state.players[playerId];
    player.stageProgress.foothill.bossDefeated = true;
    player.blessings = [
      { instanceId: "keep-strength", kind: "giantStrength" },
      { instanceId: "replace-scale", kind: "dragonScale" },
    ];
    const offeredState = forceLandingOn(state, "blessing");
    if (offeredState.phase.kind !== "blessingChoice") throw new Error("应进入赐福替换选择");
    const offered = offeredState.phase.choice.offered;

    const resolved = gameReducer(offeredState, {
      type: "chooseBlessing",
      replace: true,
      replaceInstanceId: "replace-scale",
    });

    expect(resolved.players[playerId].blessings).toEqual([
      { instanceId: "keep-strength", kind: "giantStrength" },
      offered,
    ]);
    expect(getAttack(resolved.players[playerId])).toBe(7);
    expect(getDefense(resolved.players[playerId])).toBe(2);
  });

  it("已有赐福时再次踩格，可以保留当前赐福", () => {
    const state = createInitialGame(124);
    const playerId = state.activePlayerId;
    const current = giveBlessing(state.players[playerId], "giantStrength", "current-blessing");

    const offered = forceLandingOn(state, "blessing");

    expect(offered.phase.kind).toBe("blessingChoice");
    if (offered.phase.kind !== "blessingChoice") throw new Error("应进入赐福替换选择");
    expect(offered.phase.choice.source).toBe("tile");
    expect(offered.phase.choice.offered.kind).not.toBe(current.kind);
    expect(currentActor(offered)).toBe(playerId);
    expect(canAct(offered, { type: "chooseBlessing", replace: false }, playerId)).toBe(true);

    const resolved = gameReducer(offered, { type: "chooseBlessing", replace: false });
    expect(resolved.players[playerId].blessings).toEqual([current]);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("已有赐福时再次踩格，可以更换为新赐福", () => {
    const state = createInitialGame(125);
    const playerId = state.activePlayerId;
    giveBlessing(state.players[playerId], "dragonScale", "old-blessing");
    const offeredState = forceLandingOn(state, "blessing");
    if (offeredState.phase.kind !== "blessingChoice") throw new Error("应进入赐福替换选择");
    const offered = offeredState.phase.choice.offered;

    const resolved = gameReducer(offeredState, { type: "chooseBlessing", replace: true });

    expect(resolved.players[playerId].blessings).toEqual([offered]);
    expect(resolved.phase.kind).toBe("turnComplete");
    expect(resolved.lastEvents).toContainEqual(expect.objectContaining({
      type: "blessingGranted",
      playerId,
      instanceId: offered.instanceId,
      kind: offered.kind,
    }));
  });

  it("赢家没有赐福时，败方赐福自动转移给赢家", () => {
    const state = createInitialGame(77);
    const loser = state.players.player1;
    const winner = state.players.player2;
    const blessing = giveBlessing(loser, "giantStrength");

    finishPvp(state, makeBattle({
      kind: "pvp",
      aPlayerId: loser.id,
      bPlayerId: winner.id,
    }), "b");

    expect(loser.blessings).toEqual([]);
    expect(winner.blessings).toEqual([blessing]);
    expect(getAttack(loser)).toBe(5);
    expect(getAttack(winner)).toBe(7);
    expect(state.phase.kind).toBe("pvpPenalty");
  });

  it("赢家有额外空槽时，败方赐福会自动加入而不覆盖已有赐福", () => {
    const state = createInitialGame(76);
    const loser = state.players.player1;
    const winner = state.players.player2;
    const offered = giveBlessing(loser, "giantStrength", "loser-strength");
    giveBlessing(winner, "dragonScale", "winner-scale");
    winner.stageProgress.foothill.bossDefeated = true;

    finishPvp(state, makeBattle({
      kind: "pvp",
      aPlayerId: loser.id,
      bPlayerId: winner.id,
    }), "b");

    expect(state.phase.kind).toBe("pvpPenalty");
    expect(winner.blessings).toEqual([
      { instanceId: "winner-scale", kind: "dragonScale" },
      offered,
    ]);
    expect(getAttack(winner)).toBe(7);
    expect(getDefense(winner)).toBe(4);
  });

  it("赢家已有赐福时先选择；保留后败方赐福消散", () => {
    const { state, loser, winner } = reachBlessingChoice();

    expect(state.phase.kind).toBe("blessingChoice");
    expect(currentActor(state)).toBe(winner.id);
    expect(canAct(state, { type: "chooseBlessing", replace: false }, winner.id)).toBe(true);
    expect(canAct(state, { type: "chooseBlessing", replace: false }, loser.id)).toBe(false);

    const resolved = gameReducer(state, { type: "chooseBlessing", replace: false });

    expect(resolved.players[winner.id].blessings[0].kind).toBe("dragonScale");
    expect(resolved.players[loser.id].blessings).toEqual([]);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("赢家选择覆盖时，原赐福消失并接纳败方赐福", () => {
    const { state, loser, winner, offered } = reachBlessingChoice();

    const resolved = gameReducer(state, { type: "chooseBlessing", replace: true });

    expect(resolved.players[winner.id].blessings).toEqual([offered]);
    expect(resolved.players[loser.id].blessings).toEqual([]);
    // 换成巨人之力：攻击拿到 +2，原本龙鳞的防御加成随之消失，回到基础 2
    expect(getAttack(resolved.players[winner.id])).toBe(7);
    expect(getDefense(resolved.players[winner.id])).toBe(2);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("覆盖选择阶段赢家掉线超时会自动保留原赐福", () => {
    const { state, winner } = reachBlessingChoice();
    state.unavailablePlayerIds = [winner.id];

    const resolved = handleDisconnectTimeout(state, winner.id);

    expect(resolved.players[winner.id].blessings[0].kind).toBe("dragonScale");
    expect(resolved.phase.kind).toBe("turnComplete");
  });
});
