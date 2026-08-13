import { motion } from "framer-motion";
import type { useEventQueue } from "../anim/useEventQueue";
import { isRevealed } from "../anim/visualState";
import { keywordDefinition, type KeywordKind } from "../game/content/keywords";
import { scrollDefinition } from "../game/content/scrolls";
import { isHiddenScroll } from "../game/multiplayer";
import { equipmentBlocksScrollTiming, scrollUsableAgainst } from "../game/selectors";
import type {
  BattleState,
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
export function playableFromView(
  player: PlayerView,
  timing: ScrollTiming,
  battle?: Pick<BattleState, "kind" | "enemyId" | "enemyAffix">,
) {
  if (equipmentBlocksScrollTiming(player, timing)) return [];
  return visibleScrolls(player.scrolls).filter(
    (scroll) => scrollDefinition(scroll.kind).timings.includes(timing)
      && scrollUsableAgainst(scroll.kind, battle),
  );
}

/** 手牌里能看见的牌。获得动画播完前先不显形，见 visualState.isRevealed */
export function revealedScrolls(player: PlayerView, playback: Playback) {
  return player.scrolls.filter((scroll) => isRevealed(scroll.instanceId, playback.pending));
}

/**
 * 一段卡面说明：关键字标签在前，描述文字在后。
 *
 * 两者做成一个组件而不是各渲染各的，是因为它们已经不是「装饰 + 正文」的关系——
 * 「无视防御」这句话从描述里删掉了，改由标签承担。任何只渲染 description 的地方
 * 都会缺掉那半条规则，所以干脆不给出那种用法。
 *
 * 不带自己的元素，调用方保留原来的 span / small / p，样式与布局一概不受影响。
 */
export function CardBlurb({ keywords, description }: {
  keywords: readonly KeywordKind[];
  description: string;
}) {
  return (
    <>
      {keywords.map((kind) => (
        <span
          key={kind}
          className={`keyword-tag keyword-${kind}`}
          title={keywordDefinition(kind).rule}
        >
          {keywordDefinition(kind).label}
        </span>
      ))}
      {description}
    </>
  );
}

/**
 * 详情弹层里的关键字：标签下面直接跟规则原文。
 *
 * 和 CardBlurb 分工看空间：手牌只有 96px 宽，标签只能内联挤在描述前面，规则靠
 * title 兜底；详情弹层有 720px，那句规则该直接摊开——玩家点开详情就是来读它的。
 */
export function KeywordRules({ keywords }: { keywords: readonly KeywordKind[] }) {
  if (keywords.length === 0) return null;
  return (
    <ul className="keyword-rules">
      {keywords.map((kind) => (
        <li key={kind}>
          <span className={`keyword-tag keyword-${kind}`}>
            {keywordDefinition(kind).label}
          </span>
          <em>{keywordDefinition(kind).rule}</em>
        </li>
      ))}
    </ul>
  );
}

/**
 * 读屏与 title 用的纯文本说明。
 *
 * 关键字也要念出来：标签是视觉元素，描述里那句话又已经删掉了，只读 description
 * 的话，靠读屏的玩家会漏掉整条规则。
 */
export function blurbText(keywords: readonly KeywordKind[], description: string) {
  if (keywords.length === 0) return description;
  const labels = keywords.map((kind) => keywordDefinition(kind).label).join("、");
  return `${labels}。${description}`;
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
