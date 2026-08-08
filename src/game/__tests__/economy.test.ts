import { describe, expect, it } from "vitest";
import {
  ECONOMY,
  equipmentSalvageValue,
  grantGold,
  pvpGoldTransferAmount,
} from "../economy";
import { createInitialGame, gameReducer } from "../engine";
import type { EquipmentChoiceState, GameState, OwnedEquipment } from "../types";

function atSafeCamp(seed = 20260808) {
  const state = createInitialGame(seed);
  const player = state.players[state.activePlayerId];
  player.position = state.map.regions[0].entryIndex;
  state.phase = { kind: "turnComplete" };
  return { state, player };
}

describe("金币奖励", () => {
  it("新玩家从 0 金币开始，奖励金币产生结构化事件", () => {
    const state = createInitialGame(1);
    const player = state.players.player1;

    expect(player.gold).toBe(0);
    expect(grantGold(state, player, ECONOMY.pveGold, "pveReward")).toBe(50);
    expect(player.gold).toBe(50);
    expect(state.lastEvents.at(-1)).toMatchObject({
      type: "goldChanged",
      playerId: player.id,
      from: 0,
      to: 50,
      reason: "pveReward",
    });
  });

  it("点石成金只放大奖励，50 金币变为 60 金币", () => {
    const state = createInitialGame(2);
    const player = state.players.player1;
    player.blessings = [{ instanceId: "midas-1", kind: "midasTouch" }];

    expect(grantGold(state, player, 50, "event")).toBe(60);
    expect(player.gold).toBe(60);
  });
});

/** 摆一个槽位已满的装备选择局面：owned 是身上的同类装备，offered 是新到手的那件。 */
function facingEquipmentChoice(
  owned: readonly OwnedEquipment[],
  offered: OwnedEquipment,
  source: EquipmentChoiceState["source"] = "reward",
): GameState {
  const state = createInitialGame(20260809);
  state.players.player1.equipment = [...owned];
  state.phase = {
    kind: "equipmentChoice",
    choice: {
      playerId: "player1",
      offered,
      source,
      resume: { kind: "turnComplete" },
    },
  };
  return state;
}

describe("装备折算", () => {
  it("四档品质对应四档折算价", () => {
    const player = { blessings: [] };

    expect(equipmentSalvageValue(player, "shield")).toBe(20);
    expect(equipmentSalvageValue(player, "heavyBulwark")).toBe(40);
    expect(equipmentSalvageValue(player, "namelessKnightArmor")).toBe(80);
    expect(equipmentSalvageValue(player, "undyingKingPlate")).toBe(150);
  });

  it("放弃新装备时，按新装备的品质折算", () => {
    const state = facingEquipmentChoice(
      [{ instanceId: "shield-old", kind: "shield" }],
      { instanceId: "plate-new", kind: "undyingKingPlate" },
    );

    const resolved = gameReducer(state, { type: "chooseEquipment" });

    expect(resolved.players.player1.gold).toBe(150);
    expect(resolved.players.player1.equipment.map((item) => item.instanceId))
      .toEqual(["shield-old"]);
    expect(resolved.lastEvents.find((event) => event.type === "goldChanged"))
      .toMatchObject({
        playerId: "player1",
        from: 0,
        to: 150,
        reason: "salvage",
      });
  });

  it("选择替换时，折算的是被换下的旧装备而不是新装备", () => {
    const state = facingEquipmentChoice(
      [{ instanceId: "plate-old", kind: "undyingKingPlate" }],
      { instanceId: "leather-new", kind: "borderLeather" },
    );

    const resolved = gameReducer(state, {
      type: "chooseEquipment",
      replaceInstanceId: "plate-old",
    });

    // 新装备是 N 档的边境皮甲，旧装备是 PR 档的不灭王铠，拿到的必须是后者的价
    expect(resolved.players.player1.gold).toBe(150);
    expect(resolved.players.player1.equipment.map((item) => item.instanceId))
      .toEqual(["leather-new"]);
  });

  it("相遇战抢来的装备槽满时走同一套折算", () => {
    const state = facingEquipmentChoice(
      [{ instanceId: "shield-old", kind: "shield" }],
      { instanceId: "bulwark-looted", kind: "heavyBulwark" },
      "transfer",
    );

    const resolved = gameReducer(state, { type: "chooseEquipment" });

    expect(resolved.players.player1.gold).toBe(40);
  });

  it("点石成金放大折算价，界面预览值与实际到账一致", () => {
    const state = facingEquipmentChoice(
      [{ instanceId: "shield-old", kind: "shield" }],
      { instanceId: "plate-new", kind: "undyingKingPlate" },
    );
    state.players.player1.blessings = [{ instanceId: "midas-1", kind: "midasTouch" }];
    const preview = equipmentSalvageValue(state.players.player1, "undyingKingPlate");

    const resolved = gameReducer(state, { type: "chooseEquipment" });

    expect(preview).toBe(180);
    expect(resolved.players.player1.gold).toBe(preview);
  });
});

describe("营地旅商", () => {
  it("在安全营地花 100 金币购买一张暗牌卷轴", () => {
    const { state, player } = atSafeCamp();
    player.gold = ECONOMY.shop.scroll.price;

    const bought = gameReducer(state, { type: "buyShopItem", item: "scroll" });

    expect(bought).not.toBe(state);
    expect(bought.players[player.id].gold).toBe(0);
    expect(bought.players[player.id].scrolls).toHaveLength(1);
    expect(bought.phase.kind).toBe("turnComplete");
    expect(bought.lastEvents.map((event) => event.type)).toContain("goldChanged");
    expect(bought.lastEvents.map((event) => event.type)).toContain("scrollGranted");
  });

  it("治疗补给不能在满血时购买，金币不足或离开安全区也会拒绝", () => {
    const { state, player } = atSafeCamp();
    player.gold = 99;

    expect(gameReducer(state, { type: "buyShopItem", item: "healing" })).toBe(state);

    player.hp = 10;
    player.gold = ECONOMY.shop.healing.price - 1;
    expect(gameReducer(state, { type: "buyShopItem", item: "healing" })).toBe(state);

    player.gold = 99;
    state.map.tiles[player.position].type = "event";
    expect(gameReducer(state, { type: "buyShopItem", item: "healing" })).toBe(state);
  });

  it("治疗按生命上限截断，但仍按一份补给收费", () => {
    const { state, player } = atSafeCamp();
    player.hp = player.maxHp - 2;
    player.gold = 100;

    const bought = gameReducer(state, { type: "buyShopItem", item: "healing" });

    expect(bought.players[player.id].hp).toBe(player.maxHp);
    expect(bought.players[player.id].gold).toBe(100 - ECONOMY.shop.healing.price);
  });
});

describe("相遇战金币转移", () => {
  it("按败方当前余额的 20% 向下取整", () => {
    expect(pvpGoldTransferAmount({ gold: 4 })).toBe(0);
    expect(pvpGoldTransferAmount({ gold: 5 })).toBe(1);
    expect(pvpGoldTransferAmount({ gold: 70 })).toBe(14);
    expect(pvpGoldTransferAmount({ gold: 499 })).toBe(99);
  });

  it("支付余额的 20% 且总金币守恒", () => {
    const state = createInitialGame(3);
    state.activePlayerId = "player1";
    state.players.player1.gold = 10;
    state.players.player2.gold = 80;
    state.phase = {
      kind: "pvpPenalty",
      penalty: {
        winnerId: "player1",
        loserId: "player2",
        tileIndex: state.map.regions[0].entryIndex,
      },
    };

    const settled = gameReducer(state, { type: "choosePvpPenalty", choice: "gold" });

    expect(settled.players.player1.gold).toBe(26);
    expect(settled.players.player2.gold).toBe(64);
    expect(settled.players.player1.gold + settled.players.player2.gold).toBe(90);
    expect(settled.phase.kind).not.toBe("pvpPenalty");
  });
});
