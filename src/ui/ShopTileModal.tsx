import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  equipmentCategory,
} from "../game/content/equipment";
import { SCROLLS } from "../game/content/scrolls";
import { STAT_GROWTH } from "../game/growth";
import type {
  GameStateView,
  PlayerId,
  ShopOffer,
  ShopState,
} from "../game/types";
import { DecisionModal } from "./DecisionModal";
import { type Dispatch } from "./shared";
import { ShopInventorySummary } from "./ShopInventorySummary";

function offerPresentation(offer: ShopOffer) {
  switch (offer.stock.type) {
    case "scroll": {
      const definition = offer.stock.kind ? SCROLLS[offer.stock.kind] : undefined;
      return definition
        ? {
            tag: "明牌卷轴",
            name: definition.name,
            description: definition.description,
            rarity: definition.rarity,
          }
        : {
            tag: "卷轴",
            name: "一张卷轴",
            description: "牌面仅对正在选购的玩家可见。",
          };
    }
    case "equipment": {
      const definition = EQUIPMENT[offer.stock.kind];
      return {
        tag: EQUIPMENT_CATEGORY_NAMES[equipmentCategory(offer.stock.kind)],
        name: definition.name,
        description: definition.description,
        rarity: definition.rarity,
      };
    }
    case "statGrowth": {
      const definition = STAT_GROWTH[offer.stock.option];
      return {
        tag: "永久成长",
        name: definition.name,
        description: definition.description,
      };
    }
  }
}

export function ShopTileModal({ state, shop, viewerSeat, dispatch }: {
  state: GameStateView;
  shop: ShopState;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
}) {
  const player = state.players[shop.playerId];
  if (!player) return null;
  const canBuy = viewerSeat === shop.playerId;

  return (
    <DecisionModal
      backdrop="shop-backdrop"
      className="shop-modal shop-tile-modal"
      emblem={<div className="shop-emblem">¤</div>}
      kicker="沿途商栈 · 本次货架"
      title={`${player.name}正在挑选商品`}
      lead="货架会在离店时消失；售罄商品不会补货。"
      canAct={canBuy}
      waiting={<p className="waiting-notice">等待{player.name}选购……</p>}
      actions={
        <button
          type="button"
          className="ghost-button"
          onClick={() => dispatch({ type: "leaveShop" })}
        >
          离开商栈
        </button>
      }
    >
        <ShopInventorySummary player={player} revealScrolls={canBuy} />
        <div className="shop-stock-grid">
          {shop.offers.map((offer) => {
            const presentation = offerPresentation(offer);
            const affordable = player.gold >= offer.price;
            const disabled = !canBuy || !!offer.sold || !affordable;
            return (
              <button
                type="button"
                className={`shop-offer ${offer.sold ? "sold" : ""}`}
                key={offer.id}
                disabled={disabled}
                onClick={() => dispatch({ type: "buyShopOffer", offerId: offer.id })}
              >
                <span className="shop-offer-tag">{presentation.tag}</span>
                {presentation.rarity && (
                  <em className={`card-rarity rarity-${presentation.rarity.toLowerCase()}`}>
                    {presentation.rarity}
                  </em>
                )}
                <strong>{presentation.name}</strong>
                <small>{presentation.description}</small>
                <b>{offer.sold ? "已售罄" : `${offer.price} 金币`}</b>
                {!offer.sold && canBuy && !affordable && <i>金币不足</i>}
              </button>
            );
          })}
        </div>
    </DecisionModal>
  );
}
