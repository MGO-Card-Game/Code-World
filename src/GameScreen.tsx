import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useEventQueue } from "./anim/useEventQueue";
import type { EquipmentKind } from "./game/content/equipment";
import type { GameStateView, PlayerId } from "./game/types";
import { ActionDock } from "./ui/ActionDock";
import { BattlePanel, useLingeringBattle } from "./ui/BattlePanel";
import { Board } from "./ui/Board";
import { EquipmentDetailModal } from "./ui/EquipmentDetailModal";
import {
  EquipmentChoicePanel,
  GameOverPanel,
  PenaltyPanel,
} from "./ui/outcomePanels";
import { PlayerPanel } from "./ui/PlayerPanel";
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
export function GameScreen({ state, viewerSeat, dispatch, toolbar }: {
  state: GameStateView;
  viewerSeat: PlayerId;
  dispatch: Dispatch;
  toolbar?: React.ReactNode;
}) {
  const playback = useEventQueue(state.lastEvents);
  const [caption, setCaption] = useState("");
  const [inspecting, setInspecting] = useState<PlayerId | null>(null);
  const [inspectingEquipment, setInspectingEquipment] = useState<EquipmentKind | null>(null);
  const activeName = state.players[state.activePlayerId].name;
  const lingeringBattle = useLingeringBattle(state, playback);
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
        <PlayerPanel
          player={state.players.player1}
          active={state.activePlayerId === "player1"}
          destination={state.map.tiles.length - 1}
          playback={playback}
          onInspect={() => setInspecting("player1")}
          onInspectEquipment={setInspectingEquipment}
        />
        <Board state={state} playback={playback} />
        <PlayerPanel
          player={state.players.player2}
          active={state.activePlayerId === "player2"}
          destination={state.map.tiles.length - 1}
          playback={playback}
          onInspect={() => setInspecting("player2")}
          onInspectEquipment={setInspectingEquipment}
        />
      </div>

      <ActionDock state={state} dispatch={dispatch} message={dockMessage} playback={playback} />
      <details className="history-panel">
        <summary>冒险记录</summary>
        {state.history.map((entry, index) => <p key={`${index}-${entry.text}`}>{entry.text}</p>)}
      </details>

      {/*
        四个弹层放在同一个 AnimatePresence 下，阶段切换时才有进退场衔接。
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
          <PenaltyPanel key="penalty" state={state} penalty={state.phase.penalty} dispatch={dispatch} playing={playback.playing} />
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
        {!lingeringBattle && state.phase.kind === "gameOver" && (
          <GameOverPanel key="over" winner={state.players[state.phase.winnerId]} dispatch={dispatch} />
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
      </AnimatePresence>
    </main>
  );
}
