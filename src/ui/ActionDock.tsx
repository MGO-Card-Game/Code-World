import { AnimatePresence, motion } from "framer-motion";
import { getDieSidesBonus } from "../game/selectors";
import { canUseShop } from "../game/economy";
import type { GameStateView, PlayerId } from "../game/types";
import type { Dispatch, Playback } from "./shared";

/** 底部操作条：行动提示、移动骰结果，以及当前阶段唯一可点的那颗按钮。 */
export function ActionDock({ state, dispatch, message, playback, viewerSeat, onOpenShop }: {
  state: GameStateView;
  dispatch: Dispatch;
  message: string;
  playback: Playback;
  viewerSeat: PlayerId;
  onOpenShop: () => void;
}) {
  const active = state.players[state.activePlayerId];
  // 投骰事件播到之前先不亮骰面，免得数字比动画早一步出现
  const rollPending = playback.pending.some((event) => event.type === "movementRolled");
  const die = rollPending ? undefined : state.lastMovementRoll;
  const movementSides = Math.max(2, 6 + getDieSidesBonus(active, "movement"));
  const canControlTurn = viewerSeat === state.activePlayerId;

  return (
    <section className="action-dock">
      <div>
        <span className="eyebrow">行动提示</span>
        <AnimatePresence mode="wait">
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {message}
          </motion.p>
        </AnimatePresence>
      </div>
      <AnimatePresence mode="popLayout">
        {die !== undefined && (
          <motion.div
            className="die-result"
            key={`${state.turn}-${die}`}
            aria-label={`D${movementSides} 骰子结果 ${die}`}
            initial={{ scale: 0.2, rotate: -180, opacity: 0 }}
            animate={{ scale: 1, rotate: 3, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 17 }}
          >
            {die}
          </motion.div>
        )}
      </AnimatePresence>
      {playback.playing ? (
        <button className="ghost-button" onClick={playback.skip}>跳过演出（{playback.remaining}）</button>
      ) : (
        <>
          {state.phase.kind === "awaitingRoll" && canControlTurn && (
            <button className="primary-button" onClick={() => dispatch({ type: "rollMovement" })}>为{active.name}投 D{movementSides}</button>
          )}
          {state.phase.kind === "turnComplete" && canControlTurn && (
            <div className="turn-complete-actions">
              {canUseShop(state, active) && (
                <button className="ghost-button shop-button" onClick={onOpenShop}>旅商补给</button>
              )}
              <button className="primary-button secondary" onClick={() => dispatch({ type: "endTurn" })}>结束回合</button>
            </div>
          )}
          {(state.phase.kind === "awaitingRoll" || state.phase.kind === "turnComplete") && !canControlTurn && (
            <span className="turn-waiting">等待{active.name}操作…</span>
          )}
        </>
      )}
    </section>
  );
}
