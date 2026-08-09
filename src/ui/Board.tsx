import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { visualPosition } from "../anim/visualState";
import { TILE_ICON } from "../game/content/tiles";
import { enemyDefinition } from "../game/content/enemies";
import { requirementValueForRegion, stageBossUnlocked } from "../game/stages";
import type { GameStateView, MapRegionId, MapTile } from "../game/types";
import type { Playback } from "./shared";
import { playerSigil } from "./PlayerPanel";

/*
  标注成 Record 而不是留裸对象字面量：加一种格子类型时，漏了这里只会静默掉样式，
  格子照常渲染但看不出是什么。有了标注就变成一条编译错误。
*/
const tileClassNames: Record<MapTile["type"], string> = {
  start: "start",
  battle: "battle",
  elite: "elite",
  treasure: "treasure",
  blessing: "blessing",
  spring: "spring",
  event: "event",
  shop: "shop",
  gate: "gate",
  boss: "boss",
};

const MIN_BOARD_ZOOM = 0.22;
const MAX_BOARD_ZOOM = 1.6;

interface BoardTransform {
  x: number;
  y: number;
  scale: number;
}

/** 任意矩形外框的顺时针坐标：顶边、右边、反向底边、反向左边。 */
function ringGridPosition(index: number, columns: number, rows: number) {
  const rightStart = columns;
  const bottomStart = rightStart + rows - 2;
  const leftStart = bottomStart + columns;
  if (index < rightStart) return { gridColumn: index + 1, gridRow: 1 };
  if (index < bottomStart) return { gridColumn: columns, gridRow: index - rightStart + 2 };
  if (index < leftStart) return { gridColumn: columns - (index - bottomStart), gridRow: rows };
  return { gridColumn: 1, gridRow: rows - 1 - (index - leftStart) };
}

/**
 * 三阶段分页环形棋盘。每次只渲染一个阶段，仍支持拖动与缩放（规格 4.3）。
 */
export function Board({ state, playback, onInspectBoss, focused, onToggleFocus }: {
  state: GameStateView;
  playback: Playback;
  onInspectBoss: (regionId: MapRegionId) => void;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<"action" | "overview" | "free">("action");
  const [transform, setTransform] = useState<BoardTransform>({ x: 0, y: 0, scale: 0.92 });
  const players = Object.values(state.players);
  const positions = Object.fromEntries(
    players.map((player) => [player.id, visualPosition(player, playback.pending)]),
  ) as Record<keyof typeof state.players, number>;
  const activePosition = positions[state.activePlayerId];
  const activeRegionId = state.map.tiles[activePosition].region;
  const [selectedRegionId, setSelectedRegionId] = useState<MapRegionId>(activeRegionId);
  const selectedRegion = state.map.regions.find((region) => region.id === selectedRegionId)!;
  const selectedTiles = state.map.tiles.slice(selectedRegion.startIndex, selectedRegion.endIndex + 1);
  const ringRows = (selectedTiles.length + 4 - state.map.columns * 2) / 2;
  const selectedPlayers = players.filter(
    (player) => state.map.tiles[positions[player.id]].region === selectedRegionId,
  );
  const selectedBoss = enemyDefinition(selectedRegion.bossEnemyId);

  const constrain = useCallback((candidate: BoardTransform): BoardTransform => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return candidate;
    const scaledWidth = world.offsetWidth * candidate.scale;
    const scaledHeight = world.offsetHeight * candidate.scale;
    const x = scaledWidth <= viewport.clientWidth
      ? (viewport.clientWidth - scaledWidth) / 2
      : Math.min(0, Math.max(viewport.clientWidth - scaledWidth, candidate.x));
    const y = scaledHeight <= viewport.clientHeight
      ? (viewport.clientHeight - scaledHeight) / 2
      : Math.min(0, Math.max(viewport.clientHeight - scaledHeight, candidate.y));
    return { ...candidate, x, y };
  }, []);

  const focusTile = useCallback((tileId: number) => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    const tile = world?.querySelector<HTMLElement>(`[data-tile-id="${tileId}"]`);
    if (!viewport || !world || !tile) return;
    setTransform((current) => constrain({
      ...current,
      x: viewport.clientWidth / 2 - (tile.offsetLeft + tile.offsetWidth / 2) * current.scale,
      y: viewport.clientHeight / 2 - (tile.offsetTop + tile.offsetHeight / 2) * current.scale,
    }));
  }, [constrain]);

  const zoomAt = useCallback((requestedScale: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setViewMode("free");
    const rect = viewport.getBoundingClientRect();
    const pointX = clientX === undefined ? viewport.clientWidth / 2 : clientX - rect.left;
    const pointY = clientY === undefined ? viewport.clientHeight / 2 : clientY - rect.top;
    setTransform((current) => {
      const scale = Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, requestedScale));
      const worldX = (pointX - current.x) / current.scale;
      const worldY = (pointY - current.y) / current.scale;
      return constrain({
        scale,
        x: pointX - worldX * scale,
        y: pointY - worldY * scale,
      });
    });
  }, [constrain]);

  const fitBoard = useCallback(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;
    setViewMode("overview");
    const padding = 20;
    const scale = Math.min(
      MAX_BOARD_ZOOM,
      Math.max(
        MIN_BOARD_ZOOM,
        Math.min(
          (viewport.clientWidth - padding * 2) / world.offsetWidth,
          (viewport.clientHeight - padding * 2) / world.offsetHeight,
        ),
      ),
    );
    setTransform({
      scale,
      x: (viewport.clientWidth - world.offsetWidth * scale) / 2,
      y: (viewport.clientHeight - world.offsetHeight * scale) / 2,
    });
  }, []);

  useEffect(() => {
    setSelectedRegionId(activeRegionId);
  }, [activeRegionId, state.activePlayerId, state.map.seed]);

  useEffect(() => {
    if (selectedRegionId !== activeRegionId) return;
    setViewMode("action");
    const frame = requestAnimationFrame(() => focusTile(activePosition));
    return () => cancelAnimationFrame(frame);
  }, [activePosition, activeRegionId, focusTile, selectedRegionId, state.map.seed]);

  useEffect(() => {
    const handleResize = () => setTransform((current) => constrain(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [constrain]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setTransform((current) => constrain(current));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [constrain]);

  useEffect(() => {
    if (!focused) return;
    const frame = requestAnimationFrame(fitBoard);
    return () => cancelAnimationFrame(frame);
  }, [fitBoard, focused]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 0.89;
      zoomAt(transform.scale * factor, event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [transform.scale, zoomAt]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setViewMode("free");
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => constrain({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const followActivePlayer = () => {
    setViewMode("action");
    setSelectedRegionId(activeRegionId);
    if (selectedRegionId === activeRegionId) focusTile(activePosition);
  };

  return (
    <section className="board-shell">
      <div className="mountain-glow" />
      <nav className="board-stage-tabs" aria-label="阶段地图分页">
        {state.map.regions.map((region, index) => {
          const regionPlayers = players.filter(
            (player) => state.map.tiles[positions[player.id]].region === region.id,
          );
          return (
            <button
              type="button"
              className={`${selectedRegionId === region.id ? "selected" : ""} ${activeRegionId === region.id ? "active-stage" : ""}`}
              onClick={() => {
                setViewMode("free");
                setSelectedRegionId(region.id);
              }}
              aria-current={selectedRegionId === region.id ? "page" : undefined}
              key={region.id}
            >
              <span>阶段 {index + 1}</span>
              <strong>{region.name}</strong>
              <i className="stage-tab-pieces" aria-label={`${regionPlayers.length} 名玩家`}>
                {regionPlayers.map((player) => (
                  <b
                    style={{ "--piece-color": player.color } as React.CSSProperties}
                    title={player.name}
                    key={player.id}
                  >
                    {playerSigil(player)}
                  </b>
                ))}
              </i>
            </button>
          );
        })}
      </nav>
      <div className="board-toolbar" aria-label="棋盘视图控制">
        <span>{selectedRegion.name} · {Math.round(transform.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(transform.scale - 0.15)} aria-label="缩小棋盘">−</button>
        <button type="button" onClick={() => zoomAt(transform.scale + 0.15)} aria-label="放大棋盘">＋</button>
        <button className={viewMode === "overview" ? "selected" : ""} type="button" aria-pressed={viewMode === "overview"} onClick={fitBoard} title="查看完整阶段环路">总览</button>
        <button className={viewMode === "action" ? "selected" : ""} type="button" aria-pressed={viewMode === "action"} onClick={followActivePlayer}>行动者</button>
        <button className={focused ? "selected" : ""} type="button" aria-pressed={focused} onClick={onToggleFocus}>专注</button>
      </div>
      <div
        ref={viewportRef}
        className={`board-viewport ${dragging ? "dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          ref={worldRef}
          className="board-world"
          aria-label="三阶段循环棋盘"
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          <section className={`stage-board region-${selectedRegion.id} ${activeRegionId === selectedRegion.id ? "active" : ""}`}>
            <div className="stage-board-heading">
              <span>{selectedRegion.name}</span>
              <strong>{selectedPlayers.length} 名玩家在此阶段</strong>
            </div>
            <div
              className="stage-ring"
              style={{
                gridTemplateColumns: `repeat(${state.map.columns}, var(--tile-width))`,
                gridTemplateRows: `repeat(${ringRows}, var(--tile-height))`,
              }}
            >
              {selectedTiles.map((tile, index) => {
                const playersHere = players.filter((player) => positions[player.id] === tile.id);
                return (
                  <article
                    className={`tile region-${tile.region} ${tileClassNames[tile.type]} ${activePosition === tile.id ? "current" : ""}`}
                    style={ringGridPosition(index, state.map.columns, ringRows)}
                    data-tile-id={tile.id}
                    key={tile.id}
                  >
                    <span className="tile-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="tile-icon">{TILE_ICON[tile.type]}</span>
                    <strong>{tile.label}</strong>
                    <div className="pieces">
                      {playersHere.map((player) => (
                        <motion.span
                          layoutId={`piece-${player.id}`}
                          className={`piece ${player.id === state.activePlayerId ? "active" : ""}`}
                          style={{ "--piece-color": player.color } as React.CSSProperties}
                          title={player.name}
                          key={player.id}
                          transition={{ type: "spring", stiffness: 260, damping: 26 }}
                        >
                          {playerSigil(player)}
                        </motion.span>
                      ))}
                    </div>
                  </article>
                );
              })}
              <button
                type="button"
                className={`stage-boss-card ${selectedPlayers.some((player) =>
                  stageBossUnlocked(player, selectedRegion)
                  && player.stageProgress[selectedRegion.id].bossKeyPurchased
                ) ? "unlocked" : ""}`}
                onClick={() => onInspectBoss(selectedRegion.id)}
                aria-label={`查看${selectedBoss.name}情报`}
              >
                <div className="boss-card-heading">
                  <i aria-hidden="true">首</i>
                  <div>
                    <span>阶段首领</span>
                    <strong>{selectedBoss.name}</strong>
                  </div>
                </div>
                <div className="boss-card-stats" aria-label="首领基础属性">
                  <span>生命 <b>{selectedBoss.maxHp}</b></span>
                  <span>攻击 <b>{selectedBoss.attack}</b></span>
                  <span>防御 <b>{selectedBoss.defense}</b></span>
                </div>
                {selectedRegion.requirements.map((requirement) => (
                  <small className="boss-requirement-label" key={`${requirement.type}-${requirement.target}`}>挑战条件 · {requirement.label}</small>
                ))}
                <div className="boss-player-progress">
                  {selectedPlayers.length === 0 && <small>暂无玩家进入本阶段</small>}
                  {selectedPlayers.map((player) => {
                    const defeated = player.stageProgress[selectedRegion.id].bossDefeated;
                    const unlocked = stageBossUnlocked(player, selectedRegion);
                    const keyPurchased = player.stageProgress[selectedRegion.id].bossKeyPurchased;
                    const progress = selectedRegion.requirements.map((requirement) => (
                      `${Math.min(requirementValueForRegion(player, selectedRegion.id, requirement), requirement.target)}/${requirement.target}`
                    )).join(" · ");
                    return (
                      <div key={player.id}>
                        <i style={{ "--piece-color": player.color } as React.CSSProperties}>{playerSigil(player)}</i>
                        <span>{player.name}</span>
                        <b>{defeated ? "已通过" : unlocked ? keyPurchased ? "可挑战" : "待购钥匙" : progress}</b>
                      </div>
                    );
                  })}
                </div>
                <em className="boss-detail-hint">查看完整首领情报 →</em>
              </button>
            </div>
          </section>
        </div>
      </div>
      <details className="board-legend">
        <summary>图例与棋盘操作</summary>
        <div>
          <span>拖动平移 · 滚轮缩放</span>
          <span><i className="legend-camp" />营地 · 经过回满</span>
          <span><i className="legend-battle" />战斗</span>
          <span><i className="legend-treasure" />宝箱</span>
          <span><i className="legend-blessing" />赐福</span>
          <span><i className="legend-spring" />泉水</span>
          <span><i className="legend-event" />事件</span>
        </div>
      </details>
    </section>
  );
}
