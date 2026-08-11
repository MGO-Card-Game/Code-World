import { AnimatePresence } from "framer-motion";
import type { BattleState, GameStateView, PlayerId } from "../game/types";
import { BattlePanel } from "./BattlePanel";
import { CasinoTileModal } from "./CasinoTileModal";
import { DecisionMinimizeProvider } from "./DecisionModal";
import {
  BlessingChoicePanel,
  BossGatePanel,
  EncounterChoicePanel,
  EquipmentChoicePanel,
  GameOverPanel,
  MapEventPanel,
  PenaltyPanel,
  PveRewardPanel,
  ScrollTargetChoicePanel,
  StatGrowthPanel,
} from "./outcomePanels";
import { ShopTileModal } from "./ShopTileModal";
import {
  EncounterDecisionPanel,
  TradeConfirmationPanel,
  TradeOfferPanel,
} from "./TradePanels";
import type { Dispatch, Playback } from "./shared";

/**
 * 哪些阶段的弹层可以「暂时隐藏」，以及恢复条上的按钮文案。
 *
 * 这是唯一的登记表：登记过的阶段自动长出隐藏按钮（DecisionModal 从 context 取），
 * 隐藏后自动从路由里撤下（下面统一按 decisionHidden 把关），恢复条也自动出现。
 * 加一个可隐藏的弹层只需要在这里加一条。
 *
 * key 必须能唯一标识「这一次待办」——同一阶段换了对象要算新的一次，否则玩家隐藏
 * 过一次之后，下一个同类弹层会一出生就是隐藏的。
 *
 * 两处刻意不登记：
 * - tradeOffer 的报价是组件本地状态，隐藏会连草稿一起卸掉，等于白填一遍；
 * - battle 与 gameOver 背后没有别的信息可看，隐藏它们只会让人找不到回去的路。
 */
export function pendingDecision(state: GameStateView) {
  switch (state.phase.kind) {
    case "equipmentChoice":
      return {
        key: `equipment-${state.phase.choice.offered.instanceId}`,
        label: "继续装备取舍",
      };
    case "blessingChoice":
      return {
        key: `blessing-${state.phase.choice.offered.instanceId}`,
        label: "继续赐福抉择",
      };
    case "pveReward":
      return {
        key: `reward-${state.turn}-${state.phase.notice.playerId}-${state.phase.notice.enemyName}`,
        label: "查看战斗奖励",
      };
    case "mapEventNotice":
      return {
        key: `event-${state.turn}-${state.phase.notice.playerId}-${state.phase.notice.kind}`,
        label: "查看事件结果",
      };
    case "statGrowthChoice":
      return {
        key: `growth-${state.phase.choice.playerId}-${state.phase.choice.stageId}`,
        label: "继续永久成长",
      };
    case "bossGateChoice":
      return {
        key: `boss-gate-${state.phase.choice.playerId}-${state.phase.choice.stageId}`,
        label: "继续首领入口",
      };
    case "pvpPenalty":
      return {
        key: `penalty-${state.turn}-${state.phase.penalty.loserId}`,
        label: "继续交付代价",
      };
    case "scrollTargetChoice":
      return {
        key: `scroll-target-${state.turn}-${state.phase.choice.playerId}-${state.phase.choice.scrollKind}`,
        label: "继续选择目标",
      };
    case "encounterChoice":
      return {
        key: `encounter-${state.turn}-${state.phase.choice.challengerId}`,
        label: "继续选择对手",
      };
    case "encounterDecision":
      return {
        key: `encounter-decision-${state.turn}-${state.phase.encounter.aPlayerId}-${state.phase.encounter.bPlayerId}`,
        label: "继续相遇抉择",
      };
    case "tradeConfirmation":
      return {
        key: `trade-confirm-${state.turn}-${state.phase.trade.aPlayerId}-${state.phase.trade.bPlayerId}`,
        label: "继续核对交易",
      };
    case "shop":
      return {
        key: `shop-${state.turn}-${state.phase.shop.playerId}`,
        label: "回到商栈",
      };
    case "casino":
      return {
        key: `casino-${state.turn}-${state.phase.casino.playerId}-${state.phase.casino.spins}`,
        label: "回到赌场",
      };
    default:
      return null;
  }
}

interface PhaseOverlayRouterProps {
  state: GameStateView;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
  playback: Playback;
  lingeringBattle: BattleState | null;
  decisionHidden: boolean;
  onMinimizeDecision(): void;
  canRestart: boolean;
}

/**
 * 将规则阶段映射成唯一的主弹层。
 *
 * 战斗演出结束前由 lingeringBattle 占位；其余阶段统一在这里决定是否等待播放、
 * 是否允许最小化，以及当前观看者能否操作。GameScreen 不需要知道每种阶段组件。
 */
export function PhaseOverlayRouter({
  state,
  viewerSeat,
  dispatch,
  playback,
  lingeringBattle,
  decisionHidden,
  onMinimizeDecision,
  canRestart,
}: PhaseOverlayRouterProps) {
  /*
    隐藏由 pendingDecision 单点决定，这里统一把关，不再逐个面板记得写 !decisionHidden。
    没登记的阶段 decisionHidden 恒为 false，多这道判断不会误伤。
  */
  const visible = !lingeringBattle && !decisionHidden;
  return (
    <DecisionMinimizeProvider value={pendingDecision(state) ? onMinimizeDecision : null}>
    <AnimatePresence mode="wait">
      {lingeringBattle && (
        <BattlePanel
          key="battle"
          state={state}
          battle={lingeringBattle}
          live={state.phase.kind === "battle"}
          dispatch={dispatch}
          playback={playback}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && state.phase.kind === "pvpPenalty" && (
        <PenaltyPanel
          key="penalty"
          state={state}
          penalty={state.phase.penalty}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && state.phase.kind === "blessingChoice" && (
        <BlessingChoicePanel
          key="blessing-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "scrollTargetChoice" && (
        <ScrollTargetChoicePanel
          key="event-target-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "encounterChoice" && (
        <EncounterChoicePanel
          key="encounter-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "encounterDecision" && (
        <EncounterDecisionPanel
          key={`encounter-decision-${viewerSeat}`}
          state={state}
          encounter={state.phase.encounter}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "tradeOffer" && (
        <TradeOfferPanel
          key={`trade-offer-${viewerSeat}`}
          state={state}
          trade={state.phase.trade}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "tradeConfirmation" && (
        <TradeConfirmationPanel
          key={`trade-confirmation-${viewerSeat}`}
          state={state}
          trade={state.phase.trade}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "bossGateChoice" && (
        <BossGatePanel
          key="boss-gate"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "shop" && (
        <ShopTileModal
          key={`shop-tile-${state.phase.shop.playerId}`}
          state={state}
          shop={state.phase.shop}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "casino" && (
        <CasinoTileModal
          key={`casino-tile-${state.phase.casino.playerId}`}
          state={state}
          casino={state.phase.casino}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
        />
      )}
      {visible && state.phase.kind === "equipmentChoice" && (
        <EquipmentChoicePanel
          key="equipment-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "pveReward" && (
        <PveRewardPanel
          key="pve-reward"
          state={state}
          notice={state.phase.notice}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && !playback.playing && state.phase.kind === "mapEventNotice" && (
        <MapEventPanel
          key="map-event"
          state={state}
          notice={state.phase.notice}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && state.phase.kind === "statGrowthChoice" && (
        <StatGrowthPanel
          key="stat-growth"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {visible && state.phase.kind === "gameOver" && (
        <GameOverPanel
          key="over"
          winner={state.players[state.phase.winnerId]}
          dispatch={dispatch}
          canRestart={canRestart}
        />
      )}
    </AnimatePresence>
    </DecisionMinimizeProvider>
  );
}
