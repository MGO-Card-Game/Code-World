import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEventQueue } from "./anim/useEventQueue";
import type { EquipmentKind } from "./game/content/equipment";
import type { GameStateView, MapRegionId, PlayerId } from "./game/types";
import { requirementValueForRegion, stageBossUnlocked } from "./game/stages";
import { ActionDock } from "./ui/ActionDock";
import { useLingeringBattle } from "./ui/BattlePanel";
import { Board } from "./ui/Board";
import { BossDetailModal } from "./ui/BossDetailModal";
import { EquipmentDetailModal } from "./ui/EquipmentDetailModal";
import { pendingDecision, PhaseOverlayRouter } from "./ui/PhaseOverlayRouter";
import { PlayerPanel, PlayerSummary } from "./ui/PlayerPanel";
import { ResourceModal } from "./ui/ResourceModal";
import { ShopModal } from "./ui/ShopModal";
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
  const [shopOpen, setShopOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"player" | "history" | null>(null);
  const [boardFocused, setBoardFocused] = useState(false);
  const [hiddenDecisionKey, setHiddenDecisionKey] = useState<string | null>(null);
  const activePlayer = state.players[state.activePlayerId];
  const lingeringBattle = useLingeringBattle(state, playback);
  const players = state.turnOrder.map((id) => state.players[id]);
  const selectedPlayer = state.players[selectedPlayerId];
  const stagePresentation = (player: typeof selectedPlayer) => {
    const tile = state.map.tiles[player.position];
    const region = state.map.regions.find((candidate) => candidate.id === tile.region)!;
    const progress = player.stageProgress[region.id];
    const unlocked = stageBossUnlocked(player, region);
    const requirementProgress = region.requirements.map((requirement) => (
      `${requirementValueForRegion(player, region.id, requirement)}/${requirement.target}`
    )).join(" · ");
    const status = progress.bossDefeated
      ? "已击败"
      : unlocked
        ? progress.bossKeyPurchased ? "可挑战" : "待购钥匙"
        : requirementProgress;
    return { stageName: region.name, stageStatus: status };
  };
  const selectedStage = stagePresentation(selectedPlayer);
  const activeStage = stagePresentation(activePlayer);
  const decision = pendingDecision(state);
  const decisionHidden = decision !== null && hiddenDecisionKey === decision.key;
  const choosingScrollTarget = state.phase.kind === "scrollTargetChoice";
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

  // 干扰卷轴成功打出后规则层会进入选人阶段。资源页和阶段弹层层级相同，
  // 若继续保留资源页，它会因渲染顺序靠后而遮住目标选择；这里只响应已确认的
  // phase 变化，因此被规则拒绝的卷轴动作不会误关资源页。
  useEffect(() => {
    if (!choosingScrollTarget) return;
    setInspecting(null);
    setInspectingEquipment(null);
  }, [choosingScrollTarget]);
  const dockMessage = playback.playing ? caption || state.message.text : state.message.text;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D/S</span>
          <div><span>Dicebound Summit</span><h1>骰境登峰</h1></div>
        </div>
        <div
          className="round-status"
          style={{ "--active-player-color": activePlayer.color } as React.CSSProperties}
        >
          <span>行动 {state.turn} · {activeStage.stageName}</span>
          <strong>{activePlayer.name}的回合</strong>
        </div>
        {toolbar}
      </header>

      <div className={`game-layout ${boardFocused ? "board-focused" : ""}`}>
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
                onSelect={() => {
                  setSelectedPlayerId(player.id);
                  setInspectorTab("player");
                }}
              />
              );
            })}
          </div>
        </aside>
        <section className="board-column">
          <Board
            state={state}
            playback={playback}
            onInspectBoss={setInspectingBoss}
            focused={boardFocused}
            onToggleFocus={() => setBoardFocused((focused) => !focused)}
          />
          <ActionDock
            state={state}
            dispatch={dispatch}
            message={dockMessage}
            playback={playback}
            viewerSeat={viewerSeat}
            onOpenShop={() => setShopOpen(true)}
          />
        </section>
        <aside className="inspector-rail" aria-label="信息面板">
          <button
            type="button"
            className={inspectorTab === "player" ? "selected" : ""}
            aria-expanded={inspectorTab === "player"}
            onClick={() => setInspectorTab((tab) => tab === "player" ? null : "player")}
          >
            <span aria-hidden="true">人</span>
            <strong>角色</strong>
          </button>
          <button
            type="button"
            disabled={choosingScrollTarget}
            onClick={() => setInspecting(selectedPlayer.id)}
          >
            <span aria-hidden="true">囊</span>
            <strong>资源</strong>
          </button>
          <button
            type="button"
            className={inspectorTab === "history" ? "selected" : ""}
            aria-expanded={inspectorTab === "history"}
            onClick={() => setInspectorTab((tab) => tab === "history" ? null : "history")}
          >
            <span aria-hidden="true">录</span>
            <strong>记录</strong>
          </button>
          {inspectorTab && (
            <div className={`inspector-drawer ${inspectorTab === "history" ? "history-drawer" : ""}`}>
              <button
                type="button"
                className="inspector-drawer-close"
                aria-label="关闭信息面板"
                onClick={() => setInspectorTab(null)}
              >
                ×
              </button>
              {inspectorTab === "player" ? (
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
              ) : (
                <section className="history-panel">
                  <span className="eyebrow">旅途轨迹</span>
                  <h2>冒险记录</h2>
                  <div>
                    {state.history.length === 0 && <p>旅途尚未留下记录。</p>}
                    {state.history.map((entry, index) => <p key={`${index}-${entry.text}`}>{entry.text}</p>)}
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {decisionHidden && decision && (
          <motion.aside
            className="decision-restore-bar"
            initial={{ opacity: 0, x: 24, y: 10 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role="status"
          >
            <div>
              <span>选择尚未完成</span>
              <strong>现在可以查看角色、资源与棋盘信息</strong>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => setHiddenDecisionKey(null)}
            >
              {decision.label}
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      <PhaseOverlayRouter
        state={state}
        viewerSeat={viewerSeat}
        dispatch={dispatch}
        playback={playback}
        lingeringBattle={lingeringBattle}
        decisionHidden={decisionHidden}
        onMinimizeDecision={() => setHiddenDecisionKey(decision?.key ?? null)}
        canRestart={canRestart}
      />

      {/* 资源弹窗与阶段弹层互不相干，单独一个 AnimatePresence */}
      <AnimatePresence>
        {shopOpen && (
          <ShopModal
            key="shop"
            state={state}
            viewerSeat={viewerSeat}
            dispatch={dispatch}
            onClose={() => setShopOpen(false)}
          />
        )}
        {inspecting && !choosingScrollTarget && (
          <ResourceModal
            key={`resource-${inspecting}`}
            player={state.players[inspecting]}
            map={state.map}
            playback={playback}
            onClose={() => {
              setInspecting(null);
              setInspectingEquipment(null);
            }}
            onInspectEquipment={setInspectingEquipment}
            mapUsePhase={mapUsePhase}
            onUseMapScroll={(instanceId, distance, targetPosition) =>
              dispatch({ type: "useMapScroll", instanceId, distance, targetPosition })
            }
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
