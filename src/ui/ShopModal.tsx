import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  SCROLLS,
  scrollCategory,
} from "../game/content/scrolls";
import { canUseShop, ECONOMY } from "../game/economy";
import type { GameStateView, OwnedScroll, PlayerId } from "../game/types";
import { ModalBackdrop, SPRING, type Dispatch, visibleScrolls } from "./shared";

export function ShopModal({ state, viewerSeat, dispatch, onClose }: {
  state: GameStateView;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const player = state.players[state.activePlayerId];
  const cards = visibleScrolls(player.scrolls);
  const knownScrollIds = useRef(new Set(cards.map((scroll) => scroll.instanceId)));
  const [revealedScroll, setRevealedScroll] = useState<OwnedScroll | null>(null);

  useEffect(() => {
    let gained: OwnedScroll | undefined;
    for (const scroll of cards) {
      if (!knownScrollIds.current.has(scroll.instanceId)) gained = scroll;
      knownScrollIds.current.add(scroll.instanceId);
    }
    if (gained) setRevealedScroll(gained);
  }, [player.scrolls]);

  if (viewerSeat !== player.id || !canUseShop(state, player)) return null;
  const canHeal = player.hp < player.maxHp && player.gold >= ECONOMY.shop.healing.price;
  const canBuyScroll = player.gold >= ECONOMY.shop.scroll.price;
  const revealedDefinition = revealedScroll ? SCROLLS[revealedScroll.kind] : undefined;
  const revealedCategory = revealedDefinition ? scrollCategory(revealedDefinition) : undefined;

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
        <AnimatePresence>
          {revealedScroll && revealedDefinition && revealedCategory && (
            <motion.div
              className="shop-reward-reveal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="shop-reward-title"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <motion.div
                className={`shop-reward-card scroll-${revealedScroll.kind} card-${revealedCategory}`}
                initial={{ opacity: 0, y: 36, scale: 0.72, rotate: -5 }}
                animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, y: -18, scale: 0.88 }}
                transition={SPRING}
              >
                <span className={`card-rarity rarity-${revealedDefinition.rarity.toLowerCase()}`}>
                  {revealedDefinition.rarity}
                </span>
                <span className={`shop-reward-sigil type-${revealedCategory}`} aria-hidden="true">
                  {SCROLL_CATEGORY_SIGILS[revealedCategory]}
                </span>
                <span className="shop-reward-kicker">获得卷轴</span>
                <h3 id="shop-reward-title">{revealedDefinition.name}</h3>
                <span className="shop-reward-category">{SCROLL_CATEGORY_NAMES[revealedCategory]}</span>
                <p>{revealedDefinition.description}</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setRevealedScroll(null)}
                >
                  收下并继续补给
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </ModalBackdrop>
  );
}
