import { motion } from "framer-motion";
import { canUseShop, ECONOMY } from "../game/economy";
import type { GameStateView, PlayerId } from "../game/types";
import { ModalBackdrop, SPRING, type Dispatch } from "./shared";

export function ShopModal({ state, viewerSeat, dispatch, onClose }: {
  state: GameStateView;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const player = state.players[state.activePlayerId];
  if (viewerSeat !== player.id || !canUseShop(state, player)) return null;
  const canHeal = player.hp < player.maxHp && player.gold >= ECONOMY.shop.healing.price;
  const canBuyScroll = player.gold >= ECONOMY.shop.scroll.price;

  return (
    <ModalBackdrop className="shop-backdrop">
      <motion.section
        className="shop-modal"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="shop-emblem">¤</div>
        <div className="modal-kicker">安全营地 · 旅商补给</div>
        <h2>{player.name}持有 {player.gold} 金币</h2>
        <p>购买后可以继续选购，关闭商店再结束回合。</p>
        <div className="shop-options">
          <button
            type="button"
            disabled={!canBuyScroll}
            onClick={() => dispatch({ type: "buyShopItem", item: "scroll" })}
          >
            <span>随机补给</span>
            <strong>神秘卷轴</strong>
            <small>{ECONOMY.shop.scroll.price} 金币 · 牌面仅自己可见</small>
          </button>
          <button
            type="button"
            disabled={!canHeal}
            onClick={() => dispatch({ type: "buyShopItem", item: "healing" })}
          >
            <span>生命补给</span>
            <strong>恢复 {ECONOMY.shop.healing.amount} 点生命</strong>
            <small>{player.hp >= player.maxHp ? "生命已满" : `${ECONOMY.shop.healing.price} 金币`}</small>
          </button>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>离开旅商</button>
      </motion.section>
    </ModalBackdrop>
  );
}
