import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useEventQueue } from "./anim/useEventQueue";
import type { EquipmentKind } from "./game/content/equipment";
import type { GameStateView, MapRegionId, PlayerId } from "./game/types";
import { requirementValueForRegion, stageBossUnlocked } from "./game/stages";
import { ActionDock } from "./ui/ActionDock";
import { BattlePanel, useLingeringBattle } from "./ui/BattlePanel";
import { Board } from "./ui/Board";
import { BossDetailModal } from "./ui/BossDetailModal";
import { EquipmentDetailModal } from "./ui/EquipmentDetailModal";
import {
  BlessingChoicePanel,
  BossGatePanel,
  EncounterChoicePanel,
  EquipmentChoicePanel,
  GameOverPanel,
  PenaltyPanel,
  PveRewardPanel,
} from "./ui/outcomePanels";
import { PlayerPanel, PlayerSummary } from "./ui/PlayerPanel";
import { ResourceModal } from "./ui/ResourceModal";
import type { Dispatch } from "./ui/shared";

/**
 * 对局界面。本地热座与联机共用同一套——两者的差别只在于：
 * 状态从哪来（本地 reducer / 服务器推送）、以及观看者是谁。
 *
 * `viewerSeat` 决定"我是谁"：本地模式是当前该操作的人（传设备），
 * 联机模式是自己的座位。手牌可见性完全由它决定。
 *
 * 这个文件只做布局与组装，各区域的实现在 src/ui/ 下。
 */
export function GameScreen({ state, viewerSeat, dispatch, toolbar, canRestart = true }: {
  state: GameStateView;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
  toolbar?: React.ReactNode;
  canRestart?: boolean;
}) {
  const playback = useEventQueue(state.lastEvents);
  const [caption, setCaption] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId>(viewerSeat);
  const [inspecting, setInspecting] = useState<PlayerId | null>(null);
  const [inspectingEquipment, setInspectingEquipment] = useState<EquipmentKind | null>(null);
  const [inspectingBoss, setInspectingBoss] = useState<MapRegionId | null>(null);
  const activeName = state.players[state.activePlayerId].name;
  const lingeringBattle = useLingeringBattle(state, playback);
  const players = state.turnOrder.map((id) => state.players[id]);
  const selectedPlayer = state.players[selectedPlayerId];
  const stagePresentation = (player: typeof selectedPlayer) => {
    const tile = state.map.tiles[player.position];
    const region = state.map.regions.find((candidate) => candidate.id === tile.region)!;
    const progress = player.stageProgress[region.id];
    const requirement = region.requirements[0];
    const unlocked = stageBossUnlocked(player, region);
    const status = progress.bossDefeated
      ? "已击败"
      : unlocked
        ? "可挑战"
        : `${requirementValueForRegion(player, region.id, requirement)}/${requirement.target}`;
    return { stageName: region.name, stageStatus: status };
  };
  const selectedStage = stagePresentation(selectedPlayer);
  const mapUsePhase =
    inspecting === viewerSeat &&
    inspecting === state.activePlayerId &&
    !playback.playing &&
    (state.phase.kind === "awaitingRoll" || state.phase.kind === "turnComplete")
      ? state.phase.kind
      : undefined;

  // 演出期间跟着 narration 事件逐条推进文案；播完再落到引擎的最终提示
  useEffect(() => {
    if (playback.event?.type === "narration") setCaption(playback.event.text);
  }, [playback.event]);

  // 联机席位固定；本地热座的 viewerSeat 会换人，因此详情也随当前操作者回到自己。
  useEffect(() => {
    setSelectedPlayerId(viewerSeat);
  }, [viewerSeat]);
  const dockMessage = playback.playing ? caption || state.message.text : state.message.text;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D/S</span>
          <div><span>Dicebound Summit</span><h1>骰境登峰</h1></div>
        </div>
        <div className="round-status">
          <span>行动 {state.turn}</span>
          <strong>{activeName}</strong>
        </div>
        {toolbar}
      </header>

      <div className="game-layout">
        <aside className="player-roster" aria-label="玩家列表">
          <div className="player-roster-heading">
            <span>冒险家们：</span>
            <strong>{players.length} 人</strong>
          </div>
          <div className="player-roster-list">
            {players.map((player) => {
              const stage = stagePresentation(player);
              return (
              <PlayerSummary
                key={player.id}
                player={player}
                active={state.activePlayerId === player.id}
                unavailable={state.unavailablePlayerIds.includes(player.id)}
                selected={selectedPlayerId === player.id}
                stageName={stage.stageName}
                stageStatus={stage.stageStatus}
                playback={playback}
                onSelect={() => setSelectedPlayerId(player.id)}
              />
              );
            })}
          </div>
        </aside>
        <Board state={state} playback={playback} onInspectBoss={setInspectingBoss} />
        <PlayerPanel
          key={selectedPlayer.id}
          player={selectedPlayer}
          active={state.activePlayerId === selectedPlayer.id}
          stageName={selectedStage.stageName}
          stageStatus={selectedStage.stageStatus}
          playback={playback}
          onInspect={() => setInspecting(selectedPlayer.id)}
          onInspectEquipment={setInspectingEquipment}
        />
      </div>

      <ActionDock state={state} dispatch={dispatch} message={dockMessage} playback={playback} viewerSeat={viewerSeat} />
      <details className="history-panel">
        <summary>冒险记录</summary>
        {state.history.map((entry, index) => <p key={`${index}-${entry.text}`}>{entry.text}</p>)}
      </details>

      {/*
        所有规则阶段弹层放在同一个 AnimatePresence 下，阶段切换时才有进退场衔接。
        战后的弹层都要等 lingeringBattle 让位——否则决出胜负的那一瞬间，
        战斗演出还没播，代价/装备弹层就先盖上来了。
      */}
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
          <PenaltyPanel key="penalty" state={state} penalty={state.phase.penalty} dispatch={dispatch} playing={playback.playing} viewerSeat={viewerSeat} />
        )}
        {!lingeringBattle && state.phase.kind === "blessingChoice" && (
          <BlessingChoicePanel
            key="blessing-choice"
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
        {!lingeringBattle && !playback.playing && state.phase.kind === "bossGateChoice" && (
          <BossGatePanel
            key="boss-gate"
            state={state}
            choice={state.phase.choice}
            dispatch={dispatch}
            viewerSeat={viewerSeat}
          />
        )}
        {!lingeringBattle && state.phase.kind === "equipmentChoice" && (
          <EquipmentChoicePanel
            key="equipment-choice"
            state={state}
            choice={state.phase.choice}
            dispatch={dispatch}
            playing={playback.playing}
            viewerSeat={viewerSeat}
          />
        )}
        {!lingeringBattle && !playback.playing && state.phase.kind === "pveReward" && (
          <PveRewardPanel
            key="pve-reward"
            state={state}
            notice={state.phase.notice}
            dispatch={dispatch}
            viewerSeat={viewerSeat}
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

      {/* 资源弹窗与阶段弹层互不相干，单独一个 AnimatePresence */}
      <AnimatePresence>
        {inspecting && (
          <ResourceModal
            key={`resource-${inspecting}`}
            player={state.players[inspecting]}
            playback={playback}
            onClose={() => {
              setInspecting(null);
              setInspectingEquipment(null);
            }}
            onInspectEquipment={setInspectingEquipment}
            mapUsePhase={mapUsePhase}
            onUseMapScroll={(instanceId) => dispatch({ type: "useMapScroll", instanceId })}
          />
        )}
        {inspectingEquipment && (
          <EquipmentDetailModal
            key={`equipment-${inspectingEquipment}`}
            kind={inspectingEquipment}
            onClose={() => setInspectingEquipment(null)}
          />
        )}
        {inspectingBoss && (
          <BossDetailModal
            key={`boss-${inspectingBoss}`}
            region={state.map.regions.find((region) => region.id === inspectingBoss)!}
            onClose={() => setInspectingBoss(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
