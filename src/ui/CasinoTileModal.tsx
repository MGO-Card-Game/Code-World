import { motion } from "framer-motion";
import { casinoSpinPrice } from "../game/casino";
import { STAT_GROWTH } from "../game/growth";
import type { CasinoState, GameStateView, PlayerId } from "../game/types";
import { ModalBackdrop, SPRING, type Dispatch } from "./shared";

const RESULT_PRESENTATION = {
  bust: { emblem: "◇", kicker: "轮盘落空", title: "一无所获" },
  gold: { emblem: "◆", kicker: "金币奖池", title: "金币入袋" },
  scroll: { emblem: "✦", kicker: "神秘卷轴", title: "获得卷轴" },
  equipment: { emblem: "♜", kicker: "珍奇装备", title: "获得装备" },
  statGrowth: { emblem: "♛", kicker: "赌场头奖", title: "永久成长" },
} as const;

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

  if (casino.result) {
    const result = casino.result;
    const presentation = RESULT_PRESENTATION[result.kind];
    const rewardName = result.kind === "gold"
      ? `${result.amount} 金币`
      : result.kind === "scroll" || result.kind === "equipment"
        ? result.name
        : result.kind === "statGrowth"
          ? STAT_GROWTH[result.option].name
          : "本次没有获得奖励";
    const detail = result.kind === "bust"
      ? `轮盘吞下了 ${result.price} 金币，指针停在空格。`
      : result.kind === "gold"
        ? `本次投入 ${result.price} 金币，奖池派发了 ${result.amount} 金币。`
        : result.kind === "statGrowth"
          ? STAT_GROWTH[result.option].description
          : "奖励已经放入行囊。";

    return (
      <ModalBackdrop className="reward-backdrop casino-result-backdrop">
        <motion.section
          className={`casino-result-modal result-${result.kind}`}
          initial={{ opacity: 0, scale: 0.86, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={SPRING}
          role="dialog"
          aria-modal="true"
          aria-labelledby="casino-result-title"
        >
          <motion.div
            className="casino-result-emblem"
            initial={{ rotate: -35, scale: 0.45 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 280, damping: 16 }}
          >
            {presentation.emblem}
          </motion.div>
          <div className="modal-kicker">{presentation.kicker} · 第 {casino.spins} 次转动</div>
          <h2 id="casino-result-title">{presentation.title}</h2>
          <motion.div
            className="casino-result-reward"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
          >
            <span>{result.kind === "bust" ? "转盘结果" : "本次获得"}</span>
            <strong>{rewardName}</strong>
          </motion.div>
          <p>{detail}</p>
          {canPlay ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => dispatch({ type: "acknowledgeCasinoResult" })}
            >
              确认结果
            </button>
          ) : (
            <p className="waiting-notice">等待{player.name}确认转盘结果……</p>
          )}
        </motion.section>
      </ModalBackdrop>
    );
  }

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
