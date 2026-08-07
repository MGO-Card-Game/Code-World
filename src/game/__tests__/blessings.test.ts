import { describe, expect, it } from "vitest";
import { finishPvp } from "../battle";
import {
  applyBlessingCombatRoll,
  blessingMovementRollBonus,
  grantRandomBlessing,
} from "../blessings";
import {
  BLESSINGS,
  blessingDefinition,
  pickBlessingKind,
  type BlessingKind,
} from "../content/blessings";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../engine";
import { canAct, currentActor } from "../multiplayer";
import { getAttack, getDefense } from "../selectors";
import { makeBattle, resolveRound } from "../testSupport";
import { newRollModifiers } from "../battleRound";
import type { GameState, Player } from "../types";

function giveBlessing(player: Player, kind: BlessingKind, instanceId = `test-${kind}`) {
  player.blessings = [{ instanceId, kind }];
  return player.blessings[0];
}

function reachBlessingChoice() {
  const state = createInitialGame(77);
  const loser = state.players.player1;
  const winner = state.players.player2;
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

  it("巨人之力与龙鳞护体分别提供 3 点攻击和防御", () => {
    const state = createInitialGame(1);
    giveBlessing(state.players.player1, "giantStrength");
    giveBlessing(state.players.player2, "dragonScale");

    expect(getAttack(state.players.player1)).toBe(8);
    expect(getDefense(state.players.player2)).toBe(5);
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

  it("宝物猎人开启宝箱时额外获得一件装备", () => {
    const state = createInitialGame(5);
    giveBlessing(state.players[state.activePlayerId], "treasureHunter");

    const resolved = forceLandingOn(state, "treasure");
    const player = resolved.players[resolved.activePlayerId];

    expect(player.equipment.length).toBeGreaterThanOrEqual(1);
    expect(resolved.history.some((entry) => entry.text.includes("宝物猎人额外获得"))).toBe(true);
  });

  it("宝物猎人的额外装备在槽满时进入替换或放弃流程", () => {
    const state = createInitialGame(51);
    const player = state.players[state.activePlayerId];
    giveBlessing(player, "treasureHunter");
    player.equipment = [
      { instanceId: "weapon-full", kind: "sword" },
      { instanceId: "armor-full", kind: "shield" },
      { instanceId: "shoes-full", kind: "travelerBoots" },
      { instanceId: "accessory-full-1", kind: "charm" },
      { instanceId: "accessory-full-2", kind: "fateCrown" },
    ];

    let resolved = forceLandingOn(state, "treasure");
    let choices = 0;
    while (resolved.phase.kind === "equipmentChoice") {
      choices += 1;
      resolved = gameReducer(resolved, { type: "chooseEquipment" });
    }

    expect(choices).toBeGreaterThanOrEqual(1);
    expect(resolved.phase.kind).toBe("turnComplete");
    expect(resolved.history.some((entry) => entry.text.includes("宝物猎人额外获得"))).toBe(true);
  });

  it("不屈意志用 1 点真实生命替代 PvP 惩罚，并随战败转给赢家", () => {
    const state = createInitialGame(6);
    const loser = state.players.player1;
    const winner = state.players.player2;
    loser.hp = 10;
    loser.baseDefense = 0;
    winner.baseAttack = 99;
    giveBlessing(loser, "unyieldingWill");
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pvp",
        aPlayerId: loser.id,
        bPlayerId: winner.id,
        attacker: "b",
        hpA: 1,
      }),
    };

    const resolved = resolveRound(state);

    expect(resolved.players[loser.id].hp).toBe(9);
    expect(resolved.players[loser.id].blessings).toEqual([]);
    expect(resolved.players[winner.id].blessings[0].kind).toBe("unyieldingWill");
    expect(resolved.phase.kind).not.toBe("pvpPenalty");
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

  it("停在赐福格时自动抽取，不进入额外选择阶段", () => {
    const state = createInitialGame(123);
    const playerId = state.activePlayerId;

    const resolved = forceLandingOn(state, "blessing");

    expect(resolved.phase.kind).toBe("turnComplete");
    expect(resolved.players[playerId].blessings).toHaveLength(1);
    expect(resolved.message.text).toContain("获得永久赐福");
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
    expect(getAttack(winner)).toBe(8);
    expect(state.phase.kind).toBe("pvpPenalty");
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
    expect(getAttack(resolved.players[winner.id])).toBe(8);
    expect(getDefense(resolved.players[winner.id])).toBe(2);
    expect(resolved.phase.kind).toBe("turnComplete");
  });

  it("不屈意志遇到赐福覆盖选择时，选择后仍跳过正常惩罚", () => {
    const state = createInitialGame(78);
    const loser = state.players.player1;
    const winner = state.players.player2;
    loser.hp = 10;
    giveBlessing(loser, "unyieldingWill");
    giveBlessing(winner, "dragonScale");
    finishPvp(state, makeBattle({
      kind: "pvp",
      aPlayerId: loser.id,
      bPlayerId: winner.id,
    }), "b");
    expect(state.phase.kind).toBe("blessingChoice");

    const resolved = gameReducer(state, { type: "chooseBlessing", replace: false });

    expect(resolved.players[loser.id].hp).toBe(9);
    expect(resolved.phase.kind).not.toBe("pvpPenalty");
  });

  it("覆盖选择阶段赢家掉线超时会自动保留原赐福", () => {
    const { state, winner } = reachBlessingChoice();
    state.unavailablePlayerIds = [winner.id];

    const resolved = handleDisconnectTimeout(state, winner.id);

    expect(resolved.players[winner.id].blessings[0].kind).toBe("dragonScale");
    expect(resolved.phase.kind).toBe("turnComplete");
  });
});
