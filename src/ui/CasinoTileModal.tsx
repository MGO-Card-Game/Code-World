import { motion } from "framer-motion";
import { casinoSpinPrice } from "../game/casino";
import type { CasinoState, GameStateView, PlayerId } from "../game/types";
import { ModalBackdrop, SPRING, type Dispatch } from "./shared";

export function CasinoTileModal({ state, casino, viewerSeat, dispatch }: {
  state: GameStateView;
  casino: CasinoState;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
}) {
  const player = state.players[casino.playerId];
  if (!player) return null;
  const canPlay = viewerSeat === casino.playerId;
  const price = casinoSpinPrice(casino.spins);
  const affordable = player.gold >= price;

  return (
    <ModalBackdrop className="shop-backdrop">
      <motion.section
        className="shop-modal casino-modal"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="shop-emblem casino-emblem">☖</div>
        <div className="modal-kicker">赌场转盘 · 第 {casino.spins + 1} 次转动</div>
        <h2>{player.name}持有 {player.gold} 金币</h2>
        <p>转动一次，可能空手而归、赢回金币、获得卷轴或装备，也可能转出永久属性头奖；每转一次，下一次的价格都会上涨。</p>
        <div className="casino-price">
          <span>本次价格</span>
          <b>{price} 金币</b>
        </div>
        {canPlay ? (
          <div className="casino-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!affordable}
              onClick={() => dispatch({ type: "spinCasino" })}
            >
              {affordable ? "转动轮盘" : "金币不足"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => dispatch({ type: "leaveCasino" })}
            >
              离开赌场
            </button>
          </div>
        ) : (
          <p className="waiting-notice">等待{player.name}决定要不要再转一次……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}
