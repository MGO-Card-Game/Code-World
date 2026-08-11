import { createContext, useContext, useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ModalBackdrop, SPRING } from "./shared";

/**
 * 当前阶段的「暂时隐藏」回调；null 表示这个阶段不允许隐藏。
 *
 * 走 context 而不是逐层传 prop，是因为这件事从来不是弹层自己的决定：能不能隐藏
 * 取决于 PhaseOverlayRouter 的 pendingDecision 里有没有登记这个阶段，隐藏之后
 * 由谁来恢复也在那一层。做成 prop 的时候，登记表、渲染条件、prop 三处必须同时
 * 改对，漏一处就会静默半残——按钮点了没反应，或者按钮压根不出现。
 */
const DecisionMinimizeContext = createContext<(() => void) | null>(null);

export function DecisionMinimizeProvider({ value, children }: {
  value: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <DecisionMinimizeContext.Provider value={value}>
      {children}
    </DecisionMinimizeContext.Provider>
  );
}

function DecisionMinimizeButton({ onMinimize }: { onMinimize: () => void }) {
  return (
    <button
      type="button"
      className="decision-minimize-button"
      onClick={onMinimize}
      aria-label="暂时隐藏选择界面以查看其他信息"
    >
      <span aria-hidden="true">—</span>
      暂时隐藏
    </button>
  );
}

/**
 * 规则弹层的外壳。
 *
 * 十几个弹层的骨架是同一副：遮罩、同一套进出场动画、可选的徽记、眉标题、主标题、
 * 导语，最后是「轮到自己就给操作，轮不到就说明在等谁」。各面板只留自己的正文和
 * 按钮，其余都由这里收口。
 *
 * 「暂时隐藏」按钮不由调用方决定——它跟着 context 走，登记过的阶段自动长出按钮，
 * 没登记的自动没有。decision-modal 这个类同理：它提供的是按钮的定位上下文，
 * 有按钮才该有类。
 */
export function DecisionModal({
  className,
  backdrop,
  emblem,
  kicker,
  title,
  lead,
  canAct,
  waiting,
  actions,
  children,
}: {
  className: string;
  backdrop?: string;
  emblem?: ReactNode;
  kicker: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  canAct: boolean;
  /**
   * 轮不到观看者操作时渲染的内容，通常是一条 waiting-notice。
   *
   * 这里不代为套 <p>：交易报价在等待时还要留一个「取消交易」的出口，外壳一旦
   * 把标签写死，那种情况就只能绕过外壳自己拼，反而多一条岔路。
   */
  waiting: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  const minimize = useContext(DecisionMinimizeContext);
  const titleId = useId();

  return (
    <ModalBackdrop className={backdrop}>
      <motion.section
        className={minimize ? `${className} decision-modal` : className}
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {minimize && <DecisionMinimizeButton onMinimize={minimize} />}
        {emblem}
        <div className="modal-kicker">{kicker}</div>
        <h2 id={titleId}>{title}</h2>
        {lead !== undefined && <p>{lead}</p>}
        {children}
        {canAct ? actions : waiting}
      </motion.section>
    </ModalBackdrop>
  );
}

/** 战利品、事件通知与赌场结果共用的圆形徽记。 */
export function NoticeEmblem({ className, children }: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className ?? "reward-emblem"}
      initial={{ scale: 0.5, rotate: -18 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ delay: 0.12, type: "spring", stiffness: 280, damping: 16 }}
    >{children}</motion.div>
  );
}

/** 逐条渐次浮现的列表项，战利品与事件旁白共用同一条节奏。 */
export function staggered(index: number) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.16 + index * 0.08 },
  };
}
