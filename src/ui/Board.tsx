import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { visualPosition } from "../anim/visualState";
import { TILE_ICON } from "../game/content/tiles";
import { PLAYER_IDS } from "../game/engine";
import type { GameStateView, MapTile } from "../game/types";
import type { Playback } from "./shared";

/*
  标注成 Record 而不是留裸对象字面量：加一种格子类型时，漏了这里只会静默掉样式，
  格子照常渲染但看不出是什么。有了标注就变成一条编译错误。
*/
const tileClassNames: Record<MapTile["type"], string> = {
  start: "start",
  battle: "battle",
  elite: "elite",
  treasure: "treasure",
  spring: "spring",
  event: "event",
  boss: "boss",
};

const MIN_BOARD_ZOOM = 0.22;
const MAX_BOARD_ZOOM = 1.6;

interface BoardTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * 三地区蛇形棋盘。整图不要求一屏放下，放在裁切视口里支持拖动与缩放（规格 4.3）。
 */
export function Board({ state, playback }: { state: GameStateView; playback: Playback }) {
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
  const [transform, setTransform] = useState<BoardTransform>({ x: 0, y: 0, scale: 0.85 });
  const positions = {
    player1: visualPosition(state.players.player1, playback.pending),
    player2: visualPosition(state.players.player2, playback.pending),
  };

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

  useEffect(() => {
    focusTile(positions[state.activePlayerId]);
  }, [focusTile, positions[state.activePlayerId], state.map.seed]);

  useEffect(() => {
    const handleResize = () => setTransform((current) => constrain(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [constrain]);

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

  const regionIndex = Math.min(
    state.map.regions.length - 1,
    Math.floor(positions[state.activePlayerId] / state.map.columns),
  );
  const currentRegion = state.map.regions[regionIndex];

  return (
    <section className="board-shell">
      <div className="mountain-glow" />
      <div className="board-toolbar" aria-label="棋盘视图控制">
        <span>{currentRegion.name}</span>
        <button type="button" onClick={() => zoomAt(transform.scale - 0.15)} aria-label="缩小棋盘">−</button>
        <button type="button" onClick={() => zoomAt(transform.scale + 0.15)} aria-label="放大棋盘">＋</button>
        <button type="button" onClick={() => zoomAt(MIN_BOARD_ZOOM)} title="显示完整棋盘">总览</button>
        <button type="button" onClick={() => focusTile(positions[state.activePlayerId])}>定位</button>
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
          aria-label="三地区登山棋盘"
          style={{
            gridTemplateColumns: `repeat(${state.map.columns}, var(--tile-width))`,
            gridTemplateRows: `repeat(${state.map.regions.length}, var(--tile-height))`,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          {state.map.tiles.map((tile) => {
            const tileRegionIndex = Math.floor(tile.id / state.map.columns);
            const indexInRegion = tile.id % state.map.columns;
            const column = tileRegionIndex % 2 === 0
              ? indexInRegion + 1
              : state.map.columns - indexInRegion;
            const row = state.map.regions.length - tileRegionIndex;
            const isRegionEnd = indexInRegion === state.map.columns - 1;
            const routeClass = tileRegionIndex % 2 === 0 ? "route-forward" : "route-reverse";
            const turnClass = isRegionEnd && tile.id < state.map.tiles.length - 1 ? "route-turn" : "";
            const playersHere = PLAYER_IDS.filter((id) => positions[id] === tile.id);
            return (
              <article
                className={`tile region-${tile.region} ${routeClass} ${turnClass} ${tileClassNames[tile.type]} ${positions[state.activePlayerId] === tile.id ? "current" : ""}`}
                style={{ gridColumn: column, gridRow: row }}
                data-tile-id={tile.id}
                key={tile.id}
              >
                <span className="tile-number">{String(tile.id).padStart(3, "0")}</span>
                <span className="tile-icon">{TILE_ICON[tile.type]}</span>
                <strong>{tile.label}</strong>
                <div className="pieces">
                  {playersHere.map((id) => (
                    // layoutId 让棋子在换格子时做共享元素过渡，而不是瞬移
                    <motion.span
                      layoutId={`piece-${id}`}
                      className={`piece ${id === state.activePlayerId ? "active" : ""}`}
                      style={{ "--piece-color": state.players[id].color } as React.CSSProperties}
                      title={state.players[id].name}
                      key={id}
                      transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    >
                      {id === "player1" ? "焰" : "潮"}
                    </motion.span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="board-legend">
        <span>拖动平移 · 滚轮缩放 · {Math.round(transform.scale * 100)}%</span>
        <span><i className="legend-battle" />战斗</span>
        <span><i className="legend-treasure" />宝箱</span>
        <span><i className="legend-spring" />泉水</span>
        <span><i className="legend-event" />事件</span>
      </div>
    </section>
  );
}
