import { motion } from "framer-motion";
import type { useEventQueue } from "../anim/useEventQueue";
import { isRevealed } from "../anim/visualState";
import { scrollDefinition } from "../game/content/scrolls";
import { isHiddenScroll } from "../game/multiplayer";
import type {
  GameAction,
  OwnedScroll,
  PlayerView,
  ScrollTiming,
  ScrollView,
} from "../game/types";

/**
 * 界面各块共用的类型、常量与小组件。
 *
 * 这里只放"任何一块都可能用到"的东西。只服务单个区域的助手留在那一块自己的文件里。
 */

export type Playback = ReturnType<typeof useEventQueue>;
export type Dispatch = (action: GameAction) => void;

export const SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;

/**
 * 从视图里筛出看得见牌面的卷轴。
 *
 * 对手的手牌在 viewFor 里已经被折成牌背，这里靠类型收窄挡住——
 * ScrollView 是联合类型，牌背那一支根本没有 kind 字段，
 * 想渲染牌名在编译期就过不去。
 */
export function visibleScrolls(scrolls: ScrollView[]): OwnedScroll[] {
  return scrolls.filter((scroll): scroll is OwnedScroll => !isHiddenScroll(scroll));
}

/** 视图版的可用卷轴筛选：看不见的牌不可能打得出 */
export function playableFromView(player: PlayerView, timing: ScrollTiming) {
  return visibleScrolls(player.scrolls).filter(
    (scroll) => scrollDefinition(scroll.kind).timings.includes(timing),
  );
}

/** 手牌里能看见的牌。获得动画播完前先不显形，见 visualState.isRevealed */
export function revealedScrolls(player: PlayerView, playback: Playback) {
  return player.scrolls.filter((scroll) => isRevealed(scroll.instanceId, playback.pending));
}

/**
 * 弹层背景。必须是 motion 组件，AnimatePresence 才能在卸载时播退场动画——
 * 包一层普通 div 的话退场会被直接跳过。
 */
export function ModalBackdrop({ children, className = "", onClick }: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      className={`modal-backdrop ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

export function HealthBar({ value, max }: { value: number; max: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="health-track" aria-label={`生命 ${value}/${max}`}>
      <motion.span
        initial={false}
        animate={{ width: `${percent}%` }}
        transition={{ type: "spring", stiffness: 170, damping: 26 }}
      />
    </div>
  );
}
