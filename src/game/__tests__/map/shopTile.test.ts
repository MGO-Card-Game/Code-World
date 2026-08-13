import { describe, expect, it } from "vitest";
import {
  EQUIPMENT,
  equipmentCategory,
  type EquipmentKind,
} from "../../content/equipment";
import { equipmentSalvageValue } from "../../economy";
import { createInitialGame, gameReducer, handleDisconnectTimeout } from "../../engine";
import { STAT_GROWTH } from "../../growth";
import { canAct, currentActor, viewFor } from "../../multiplayer";
import {
  SHOP_PRICES,
  statGrowthShopPrice,
  variableShopPrice,
} from "../../shop";
import { resolveTile } from "../../tiles";
import type { CardRarity } from "../../content/rarity";
import type { GameState, PlayerId, ShopOffer } from "../../types";

function enterShop(seed = 20260808) {
  const state = createInitialGame(seed);
  const playerId = state.activePlayerId;
  const player = state.players[playerId];
  const tile = state.map.tiles.find(
    (candidate) => candidate.type === "shop" && candidate.region === "foothill",
  );
  if (!tile) throw new Error("山脚应生成商店格");
  player.position = tile.id;
  resolveTile(state, tile);
  if (state.phase.kind !== "shop") throw new Error("踩商店格后应进入 shop phase");
  return { state, playerId, tile, shop: state.phase.shop };
}

function offerOf<T extends ShopOffer["stock"]["type"]>(
  offers: ShopOffer[],
  type: T,
) {
  const offer = offers.find(
    (candidate): candidate is ShopOffer & { stock: Extract<ShopOffer["stock"], { type: T }> } =>
      candidate.stock.type === type,
  );
  if (!offer) throw new Error(`缺少 ${type} 货位`);
  return offer;
}

describe("商店格库存", () => {
  it("同种子货架一致，每次重新进入都会沿同一随机流刷新", () => {
    const first = enterShop(8001);
    const replay = enterShop(8001);

    expect(replay.shop.offers).toEqual(first.shop.offers);
    const initialOffers = structuredClone(first.shop.offers);

    const left = gameReducer(first.state, { type: "leaveShop" });
    resolveTile(left, first.tile);
    if (left.phase.kind !== "shop") throw new Error("再次进入应重新生成商店");

    const replayLeft = gameReducer(replay.state, { type: "leaveShop" });
    resolveTile(replayLeft, replay.tile);
    if (replayLeft.phase.kind !== "shop") throw new Error("重放应再次进入商店");

    expect(replayLeft.phase.shop.offers).toEqual(left.phase.shop.offers);
    expect(left.phase.shop.offers).not.toEqual(initialOffers);
  });

  it("固定为卷轴、四个装备部位和一个属性货位", () => {
    const { shop } = enterShop(8002);
    expect(shop.offers).toHaveLength(6);
    expect(shop.offers.map((offer) => offer.stock.type)).toEqual([
      "scroll",
      "equipment",
      "equipment",
      "equipment",
      "equipment",
      "statGrowth",
    ]);
    expect(shop.offers.slice(1, 5).map((offer) =>
      offer.stock.type === "equipment" ? equipmentCategory(offer.stock.kind) : undefined
    )).toEqual(["weapon", "armor", "shoes", "accessory"]);
  });

  it("装备最低售价始终高于带点石成金的折算上限", () => {
    const state = createInitialGame(8003);
    const player = state.players[state.activePlayerId];
    player.blessings = [{ instanceId: "midas-shop", kind: "midasTouch" }];
    const rarities = Object.keys(SHOP_PRICES.equipment) as CardRarity[];

    for (const rarity of rarities) {
      const kind = (Object.keys(EQUIPMENT) as EquipmentKind[])
        .find((candidate) => EQUIPMENT[candidate].rarity === rarity);
      if (!kind) throw new Error(`${rarity} 应至少有一件装备`);
      expect(variableShopPrice(SHOP_PRICES.equipment[rarity], 0))
        .toBeGreaterThan(equipmentSalvageValue(player, kind));
    }
  });

  it("属性售价不浮动，只按累计购买次数递增", () => {
    expect([0, 1, 2, 3].map(statGrowthShopPrice)).toEqual([250, 400, 640, 1020]);
    const entered = enterShop(8004);
    const player = entered.state.players[entered.playerId];
    const statOffer = offerOf(entered.shop.offers, "statGrowth");
    player.gold = 10_000;
    const before = {
      attack: player.baseAttack,
      defense: player.baseDefense,
      maxHp: player.maxHp,
    };

    const bought = gameReducer(entered.state, {
      type: "buyShopOffer",
      offerId: statOffer.id,
    });
    expect(bought.players[entered.playerId].statPurchases).toBe(1);
    const option = statOffer.stock.option;
    const valueAfter = option === "attack"
      ? bought.players[entered.playerId].baseAttack
      : option === "defense"
        ? bought.players[entered.playerId].baseDefense
        : bought.players[entered.playerId].maxHp;
    expect(valueAfter).toBe(before[option] + STAT_GROWTH[option].value);

    const left = gameReducer(bought, { type: "leaveShop" });
    resolveTile(left, entered.tile);
    if (left.phase.kind !== "shop") throw new Error("应重新进入商店");
    expect(offerOf(left.phase.shop.offers, "statGrowth").price).toBe(400);
  });
});

describe("商店格购买与状态恢复", () => {
  it("金币不足、售罄和错误货位都按非法动作原样拒绝", () => {
    const entered = enterShop(8101);
    const offer = entered.shop.offers[0];

    expect(gameReducer(entered.state, { type: "buyShopOffer", offerId: offer.id }))
      .toBe(entered.state);
    expect(gameReducer(entered.state, { type: "buyShopOffer", offerId: 99 }))
      .toBe(entered.state);

    entered.state.players[entered.playerId].gold = 10_000;
    const bought = gameReducer(entered.state, { type: "buyShopOffer", offerId: offer.id });
    expect(bought).not.toBe(entered.state);
    expect(gameReducer(bought, { type: "buyShopOffer", offerId: offer.id })).toBe(bought);
  });

  it("满槽购买装备后回到同一货架，不重复扣款且保持售罄", () => {
    const entered = enterShop(8102);
    const player = entered.state.players[entered.playerId];
    const equipmentOffer = entered.shop.offers.find(
      (offer) => offer.stock.type === "equipment"
        && equipmentCategory(offer.stock.kind) === "weapon",
    );
    if (!equipmentOffer || equipmentOffer.stock.type !== "equipment") {
      throw new Error("缺少武器货位");
    }
    player.equipment = [{ instanceId: "old-weapon", kind: equipmentOffer.stock.kind }];
    player.gold = 10_000;

    const bought = gameReducer(entered.state, {
      type: "buyShopOffer",
      offerId: equipmentOffer.id,
    });
    expect(bought.phase.kind).toBe("equipmentChoice");
    if (bought.phase.kind !== "equipmentChoice") throw new Error("应进入装备选择");
    expect(bought.phase.choice.resume.kind).toBe("shop");
    const goldAfterPurchase = bought.players[entered.playerId].gold;

    const resumed = gameReducer(bought, { type: "chooseEquipment" });
    expect(resumed.phase.kind).toBe("shop");
    if (resumed.phase.kind !== "shop") throw new Error("选择后应回到商店");
    expect(resumed.phase.shop.offers[equipmentOffer.id].sold).toBe(true);
    expect(resumed.players[entered.playerId].gold).toBe(
      goldAfterPurchase + equipmentSalvageValue(resumed.players[entered.playerId], equipmentOffer.stock.kind),
    );
  });

  it("只有店内玩家能购买和离店，currentActor 也指向该玩家", () => {
    const { state, playerId, shop } = enterShop(8103);
    const other = state.turnOrder.find((id) => id !== playerId) as PlayerId;
    expect(currentActor(state)).toBe(playerId);
    expect(canAct(state, { type: "buyShopOffer", offerId: shop.offers[0].id }, playerId)).toBe(true);
    expect(canAct(state, { type: "leaveShop" }, playerId)).toBe(true);
    expect(canAct(state, { type: "leaveShop" }, other)).toBe(false);
  });
});

describe("商店格联机与地图语义", () => {
  it("每个区域恰好两个安全商店，同格对手不会抢先触发相遇", () => {
    const entered = enterShop(8201);
    for (const region of entered.state.map.regions) {
      const shops = entered.state.map.tiles.slice(region.startIndex, region.endIndex + 1)
        .filter((tile) => tile.type === "shop");
      expect(shops).toHaveLength(2);
      expect(shops.every((shop) => shop.safeZone)).toBe(true);
    }

    const state = createInitialGame(8202);
    const player = state.players[state.activePlayerId];
    const opponentId = state.turnOrder.find((id) => id !== player.id)!;
    const tile = state.map.tiles.find((candidate) => candidate.type === "shop")!;
    player.position = tile.id;
    state.players[opponentId].position = tile.id;
    resolveTile(state, tile);
    expect(state.phase.kind).toBe("shop");
  });

  it("旁观者看不到顶层货架的卷轴 kind，但仍能看到价格", () => {
    const { state, playerId, shop } = enterShop(8203);
    const other = state.turnOrder.find((id) => id !== playerId)!;
    const buyerView = viewFor(state, playerId);
    const otherView = viewFor(state, other);
    if (buyerView.phase.kind !== "shop" || otherView.phase.kind !== "shop") {
      throw new Error("两份视图都应停在商店");
    }
    const rawScroll = offerOf(shop.offers, "scroll");
    const buyerScroll = offerOf(buyerView.phase.shop.offers, "scroll");
    const hiddenScroll = offerOf(otherView.phase.shop.offers, "scroll");
    expect(buyerScroll.stock.kind).toBe(rawScroll.stock.kind);
    expect(hiddenScroll.stock.kind).toBeUndefined();
    expect(hiddenScroll.price).toBe(rawScroll.price);
    expect(offerOf(shop.offers, "scroll").stock.kind).toBe(rawScroll.stock.kind);
  });

  it("商店中直接掉线会离店并轮转", () => {
    const { state, playerId } = enterShop(8204);
    state.unavailablePlayerIds = [playerId];
    const resolved = handleDisconnectTimeout(state, playerId);
    expect(resolved.activePlayerId).not.toBe(playerId);
    expect(resolved.phase.kind).not.toBe("shop");
  });

  it("商店装备选择中掉线会在同一次兜底里放弃装备、离店并轮转", () => {
    const entered = enterShop(8205);
    const player = entered.state.players[entered.playerId];
    const offer = entered.shop.offers.find(
      (candidate) => candidate.stock.type === "equipment"
        && equipmentCategory(candidate.stock.kind) === "weapon",
    );
    if (!offer || offer.stock.type !== "equipment") throw new Error("缺少武器货位");
    player.equipment = [{ instanceId: "disconnect-old", kind: offer.stock.kind }];
    player.gold = 10_000;
    const choosing = gameReducer(entered.state, { type: "buyShopOffer", offerId: offer.id });
    expect(choosing.phase.kind).toBe("equipmentChoice");
    choosing.unavailablePlayerIds = [entered.playerId];

    const resolved = handleDisconnectTimeout(choosing, entered.playerId);
    expect(resolved.activePlayerId).not.toBe(entered.playerId);
    expect(resolved.phase.kind).not.toBe("equipmentChoice");
    expect(resolved.phase.kind).not.toBe("shop");
  });
});
