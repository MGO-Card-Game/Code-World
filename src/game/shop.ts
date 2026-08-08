import {
  EQUIPMENT,
  pickEquipmentKind,
  type EquipmentCategory,
} from "./content/equipment";
import type { CardRarity } from "./content/rarity";
import { pickScrollKind, SCROLLS } from "./content/scrolls";
import { GOLD_SCALE, spendGold } from "./economy";
import { applyStatGrowth, STAT_GROWTH, STAT_GROWTH_OPTIONS } from "./growth";
import { grantEquipment, grantScroll, rewardSecret } from "./resources";
import { addHistory, nextRandom } from "./state";
import type {
  ActionResult,
  GameState,
  Player,
  ShopOffer,
  ShopState,
} from "./types";

export const SHOP_PRICES = {
  equipment: {
    N: 60,
    R: 120,
    SR: 220,
    PR: 400,
  } satisfies Record<CardRarity, number>,
  scroll: {
    N: 40,
    R: 80,
    SR: 150,
    PR: 280,
  } satisfies Record<CardRarity, number>,
  statGrowth: {
    base: 250,
    multiplier: 1.6,
  },
} as const;

const EQUIPMENT_CATEGORIES: readonly EquipmentCategory[] = [
  "weapon",
  "armor",
  "shoes",
  "accessory",
];

function roundGold(price: number) {
  return Math.round(price / GOLD_SCALE) * GOLD_SCALE;
}

/** 卷轴与装备独立浮动；randomValue 参数让边界定价可以脱离随机流测试。 */
export function variableShopPrice(basePrice: number, randomValue: number) {
  const bounded = Math.min(0.999999999, Math.max(0, randomValue));
  return roundGold(basePrice * (0.75 + bounded * 0.5));
}

/** 永久属性只按累计购买次数递增，不参与货架价格浮动。 */
export function statGrowthShopPrice(statPurchases: number) {
  const purchases = Math.max(0, Math.floor(statPurchases));
  return roundGold(SHOP_PRICES.statGrowth.base * SHOP_PRICES.statGrowth.multiplier ** purchases);
}

export function rollShopStock(state: GameState, player: Player): ShopState {
  const offers: ShopOffer[] = [];
  const addOffer = (stock: ShopOffer["stock"], price: number) => {
    offers.push({ id: offers.length, stock, price });
  };

  const scrollKind = pickScrollKind(() => nextRandom(state));
  addOffer(
    { type: "scroll", kind: scrollKind },
    variableShopPrice(SHOP_PRICES.scroll[SCROLLS[scrollKind].rarity], nextRandom(state)),
  );

  for (const category of EQUIPMENT_CATEGORIES) {
    const kind = pickEquipmentKind(() => nextRandom(state), { category });
    addOffer(
      { type: "equipment", kind },
      variableShopPrice(SHOP_PRICES.equipment[EQUIPMENT[kind].rarity], nextRandom(state)),
    );
  }

  const option = STAT_GROWTH_OPTIONS[
    Math.floor(nextRandom(state) * STAT_GROWTH_OPTIONS.length)
  ];
  addOffer(
    { type: "statGrowth", option },
    statGrowthShopPrice(player.statPurchases),
  );

  return { playerId: player.id, tileIndex: player.position, offers };
}

export function buyShopOffer(state: GameState, offerId: number): ActionResult {
  if (state.phase.kind !== "shop" || !Number.isInteger(offerId)) return false;
  const shop = state.phase.shop;
  const player = state.players[shop.playerId];
  const offer = shop.offers.find((candidate) => candidate.id === offerId);
  if (!player || player.position !== shop.tileIndex || !offer || offer.sold) return false;
  if (offer.stock.type === "scroll" && !offer.stock.kind) return false;
  if (!spendGold(state, player, offer.price)) return false;

  offer.sold = true;
  switch (offer.stock.type) {
    case "scroll": {
      const reward = grantScroll(state, player, offer.stock.kind);
      const line = (what: string) =>
        `${player.name}在商栈花费 ${offer.price} 金币购买了${what}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return true;
    }
    case "equipment": {
      const reward = grantEquipment(
        state,
        player,
        offer.stock.kind,
        { kind: "shop", shop },
      );
      addHistory(
        state,
        `${player.name}在商栈花费 ${offer.price} 金币购买了${reward.name}。`,
      );
      return true;
    }
    case "statGrowth":
      applyStatGrowth(state, player, offer.stock.option);
      player.statPurchases += 1;
      addHistory(
        state,
        `${player.name}在商栈花费 ${offer.price} 金币，获得${STAT_GROWTH[offer.stock.option].name}。`,
      );
      return true;
  }
}

export function leaveShop(state: GameState) {
  if (state.phase.kind !== "shop") return false;
  const player = state.players[state.phase.shop.playerId];
  if (!player) return false;
  state.phase = { kind: "turnComplete" };
  addHistory(state, `${player.name}离开商栈。`);
  return true;
}
