import { describe, expect, it } from "vitest";
import { ECONOMY, grantGold, pvpGoldTransferAmount } from "../economy";
import { createInitialGame, gameReducer } from "../engine";

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
    state.map.tiles[player.position].safeZone = false;
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
