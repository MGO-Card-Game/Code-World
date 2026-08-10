import { AnimatePresence, motion } from "framer-motion";
import { getDieSidesBonus } from "../game/selectors";
import { canUseShop } from "../game/economy";
import type { GameStateView, PlayerId } from "../game/types";
import type { Dispatch, Playback } from "./shared";

interface ActionGuidance {
  label: string;
  action: string;
  waitingAction?: string;
  actorIds: PlayerId[];
}

/** 把引擎阶段翻译成玩家真正需要完成的下一步。 */
export function actionGuidance(state: GameStateView, movementSides: number): ActionGuidance {
  const phase = state.phase;
  switch (phase.kind) {
    case "awaitingRoll":
      return {
        label: "移动阶段",
        action: `投掷 D${movementSides}`,
        waitingAction: "投骰",
        actorIds: [state.activePlayerId],
      };
    case "turnComplete":
      return {
        label: "行动完成",
        action: "结束当前回合",
        actorIds: [state.activePlayerId],
      };
    case "encounterChoice":
      return {
        label: "旅者相遇",
        action: "选择相遇对象",
        actorIds: [phase.choice.challengerId],
      };
    case "scrollTargetChoice":
      return {
        label: "选定目标",
        action: "选择一名玩家",
        actorIds: [phase.choice.playerId],
      };
    case "encounterDecision": {
      const encounter = phase.encounter;
      return {
        label: "相遇抉择",
        action: "选择交易、招呼或战斗",
        actorIds: [
          encounter.choiceA.status === "pending" ? encounter.aPlayerId : undefined,
          encounter.choiceB.status === "pending" ? encounter.bPlayerId : undefined,
        ].filter((id): id is PlayerId => id !== undefined),
      };
    }
    case "tradeOffer": {
      const trade = phase.trade;
      return {
        label: "秘密报价",
        action: "提交交易报价",
        actorIds: [
          trade.offerA.status === "pending" ? trade.aPlayerId : undefined,
          trade.offerB.status === "pending" ? trade.bPlayerId : undefined,
        ].filter((id): id is PlayerId => id !== undefined),
      };
    }
    case "tradeConfirmation": {
      const trade = phase.trade;
      return {
        label: "交易确认",
        action: "核对并确认双方报价",
        actorIds: [
          trade.confirmationA === "pending" ? trade.aPlayerId : undefined,
          trade.confirmationB === "pending" ? trade.bPlayerId : undefined,
        ].filter((id): id is PlayerId => id !== undefined),
      };
    }
    case "bossGateChoice":
      {
        const choice = phase.choice;
        const hasKey = state.players[choice.playerId]
          .stageProgress[choice.stageId].bossKeyPurchased;
        return {
          label: "首领入口",
          action: hasKey ? "决定是否进入挑战首领" : "购买阶段钥匙或暂时离开",
          actorIds: [choice.playerId],
        };
      }
    case "battle": {
      const battle = phase.battle;
      const attacker = battle.attacker;
      const defender = attacker === "a" ? "b" : "a";
      const pendingSide = [attacker, defender].find((side) => {
        const choice = side === "a" ? battle.choiceA : battle.choiceB;
        const owner = side === "a" ? battle.aPlayerId : battle.bPlayerId;
        return owner !== undefined && choice.status === "pending";
      });
      const actorId = pendingSide === "a" ? battle.aPlayerId : pendingSide === "b" ? battle.bPlayerId : undefined;
      return {
        label: pendingSide
          ? `战斗阶段 · ${pendingSide === attacker ? "攻击方" : "防守方"}`
          : "战斗结算",
        action: "选择本轮卷轴",
        actorIds: actorId ? [actorId] : [],
      };
    }
    case "blessingChoice":
      return {
        label: "赐福抉择",
        action: "决定是否替换现有赐福",
        actorIds: [phase.choice.winnerId],
      };
    case "pvpPenalty":
      return {
        label: "相遇战代价",
        action: phase.penalty.waived ? "代价已免除" : "选择交付资源",
        actorIds: phase.penalty.waived ? [] : [phase.penalty.loserId],
      };
    case "equipmentChoice":
      return {
        label: "装备取舍",
        action: "选择替换装备或拆解新品",
        actorIds: [phase.choice.playerId],
      };
    case "pveReward":
      return {
        label: "战利品结算",
        action: "确认本次战斗奖励",
        actorIds: [phase.notice.playerId],
      };
    case "statGrowthChoice":
      return {
        label: "永久成长",
        action: "选择一项属性提升",
        actorIds: [phase.choice.playerId],
      };
    case "shop":
      return {
        label: "沿途商栈",
        action: "选购物品或离开商店",
        actorIds: [phase.shop.playerId],
      };
    case "casino":
      return {
        label: "赌场转盘",
        action: phase.casino.result ? "确认本次转盘结果" : "决定转动转盘或离开",
        actorIds: [phase.casino.playerId],
      };
    case "gameOver":
      return {
        label: "登峰决胜",
        action: `${state.players[phase.winnerId].name}获得胜利`,
        actorIds: [],
      };
  }
}

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
  const guidance = actionGuidance(state, movementSides);
  const canControlTurn = viewerSeat === state.activePlayerId;
  const viewerMustAct = guidance.actorIds.includes(viewerSeat);
  const hasPendingActor = guidance.actorIds.length > 0;
  const waitingNames = guidance.actorIds
    .filter((id) => id !== viewerSeat)
    .map((id) => state.players[id].name)
    .join("、");
  const guidanceText = playback.playing
    ? `${guidance.label} · 演出结算中`
    : viewerMustAct
      ? `${guidance.label} · 请${guidance.action}`
      : waitingNames
        ? `${guidance.label} · 等待${waitingNames}${guidance.waitingAction ?? guidance.action}`
        : `${guidance.label} · ${guidance.action}`;

  return (
    <section
      className="action-dock"
      style={{ "--active-player-color": active.color } as React.CSSProperties}
    >
      <div className="action-dock-copy">
        <span className="eyebrow">
          {playback.playing
            ? "行动结算"
            : viewerMustAct
              ? "你的行动"
              : hasPendingActor
                ? "等待行动"
                : "阶段状态"}
        </span>
        <strong className="action-dock-title">{active.name}的回合</strong>
        <span className="action-dock-phase">{guidanceText}</span>
        <AnimatePresence mode="wait">
          <motion.p
            className="action-dock-message"
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
            <button className="primary-button action-primary-button" onClick={() => dispatch({ type: "rollMovement" })}>
              <span className="action-button-icon" aria-hidden="true">骰</span>
              <span>
                <strong>投掷 D{movementSides}</strong>
                <small>为{active.name}</small>
              </span>
            </button>
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
