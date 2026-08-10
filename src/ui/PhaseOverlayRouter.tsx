import { AnimatePresence } from "framer-motion";
import type { BattleState, GameStateView, PlayerId } from "../game/types";
import { BattlePanel } from "./BattlePanel";
import { CasinoTileModal } from "./CasinoTileModal";
import {
  BlessingChoicePanel,
  BossGatePanel,
  EncounterChoicePanel,
  EquipmentChoicePanel,
  GameOverPanel,
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
    case "statGrowthChoice":
      return {
        key: `growth-${state.phase.choice.playerId}-${state.phase.choice.stageId}`,
        label: "继续永久成长",
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
  return (
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
      {!lingeringBattle && state.phase.kind === "pvpPenalty" && (
        <PenaltyPanel
          key="penalty"
          state={state}
          penalty={state.phase.penalty}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !decisionHidden && state.phase.kind === "blessingChoice" && (
        <BlessingChoicePanel
          key="blessing-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
          onMinimize={onMinimizeDecision}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "scrollTargetChoice" && (
        <ScrollTargetChoicePanel
          key="event-target-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "encounterChoice" && (
        <EncounterChoicePanel
          key="encounter-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "encounterDecision" && (
        <EncounterDecisionPanel
          key={`encounter-decision-${viewerSeat}`}
          state={state}
          encounter={state.phase.encounter}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "tradeOffer" && (
        <TradeOfferPanel
          key={`trade-offer-${viewerSeat}`}
          state={state}
          trade={state.phase.trade}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "tradeConfirmation" && (
        <TradeConfirmationPanel
          key={`trade-confirmation-${viewerSeat}`}
          state={state}
          trade={state.phase.trade}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "bossGateChoice" && (
        <BossGatePanel
          key="boss-gate"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "shop" && (
        <ShopTileModal
          key={`shop-tile-${state.phase.shop.playerId}`}
          state={state}
          shop={state.phase.shop}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
        />
      )}
      {!lingeringBattle && !playback.playing && state.phase.kind === "casino" && (
        <CasinoTileModal
          key={`casino-tile-${state.phase.casino.playerId}`}
          state={state}
          casino={state.phase.casino}
          viewerSeat={viewerSeat}
          dispatch={dispatch}
        />
      )}
      {!lingeringBattle && !decisionHidden && state.phase.kind === "equipmentChoice" && (
        <EquipmentChoicePanel
          key="equipment-choice"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
          onMinimize={onMinimizeDecision}
        />
      )}
      {!lingeringBattle && !decisionHidden && !playback.playing && state.phase.kind === "pveReward" && (
        <PveRewardPanel
          key="pve-reward"
          state={state}
          notice={state.phase.notice}
          dispatch={dispatch}
          viewerSeat={viewerSeat}
          onMinimize={onMinimizeDecision}
        />
      )}
      {!lingeringBattle && !decisionHidden && state.phase.kind === "statGrowthChoice" && (
        <StatGrowthPanel
          key="stat-growth"
          state={state}
          choice={state.phase.choice}
          dispatch={dispatch}
          playing={playback.playing}
          viewerSeat={viewerSeat}
          onMinimize={onMinimizeDecision}
        />
      )}
      {!lingeringBattle && state.phase.kind === "gameOver" && (
        <GameOverPanel
          key="over"
          winner={state.players[state.phase.winnerId]}
          dispatch={dispatch}
          canRestart={canRestart}
        />
      )}
    </AnimatePresence>
  );
}
