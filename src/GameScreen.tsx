import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { handCardLayout, handSpacing } from "./anim/handLayout";
import { useEventQueue } from "./anim/useEventQueue";
import {
  activeDamage,
  isRevealed,
  visualBattleHp,
  visualHp,
  visualMaxHp,
  visualPosition,
} from "./anim/visualState";
import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  equipmentCategory,
} from "./game/content/equipment";
import { SCROLLS, scrollDefinition } from "./game/content/scrolls";
import { TILE_ICON } from "./game/content/tiles";
import { getBattleParticipants, getSidePlayer, PLAYER_IDS } from "./game/engine";
import { isHiddenScroll } from "./game/multiplayer";
import { getAttack, getDefense, getDieSidesBonus } from "./game/selectors";
import type {
  BattleState,
  CombatSide,
  EquipmentChoiceState,
  GameAction,
  GameStateView,
  OwnedScroll,
  PlayerId,
  PlayerView,
  PvpPenaltyState,
  ScrollTiming,
  ScrollView,
} from "./game/types";

type Playback = ReturnType<typeof useEventQueue>;
type Dispatch = (action: GameAction) => void;

/**
 * 从视图里筛出看得见牌面的卷轴。
 *
 * 对手的手牌在 viewFor 里已经被折成牌背，这里靠类型收窄挡住——
 * ScrollView 是联合类型，牌背那一支根本没有 kind 字段，
 * 想渲染牌名在编译期就过不去。
 */
function visibleScrolls(scrolls: ScrollView[]): OwnedScroll[] {
  return scrolls.filter((scroll): scroll is OwnedScroll => !isHiddenScroll(scroll));
}

/** 视图版的可用卷轴筛选：看不见的牌不可能打得出 */
function playableFromView(player: PlayerView, timing: ScrollTiming) {
  return visibleScrolls(player.scrolls).filter(
    (scroll) => scrollDefinition(scroll.kind).timings.includes(timing),
  );
}

const tileClassNames = {
  start: "start",
  battle: "battle",
  treasure: "treasure",
  spring: "spring",
  event: "event",
  boss: "boss",
};

const SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;

/**
 * 弹层背景。必须是 motion 组件，AnimatePresence 才能在卸载时播退场动画——
 * 包一层普通 div 的话退场会被直接跳过。
 */
function ModalBackdrop({ children, className = "", onClick }: {
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

function HealthBar({ value, max }: { value: number; max: number }) {
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

/** 手牌里能看见的牌。获得动画播完前先不显形，见 visualState.isRevealed */
function revealedScrolls(player: PlayerView, playback: Playback) {
  return player.scrolls.filter((scroll) => isRevealed(scroll.instanceId, playback.pending));
}

/** 侧栏里只显示牌背和张数，真正的手牌在底部手牌坞 */
function HandBacks({ player, playback }: { player: PlayerView; playback: Playback }) {
  const cards = revealedScrolls(player, playback);
  return (
    <div className="hand-backs">
      <AnimatePresence initial={false} mode="popLayout">
        {cards.map((scroll, index) => (
          <motion.span
            key={scroll.instanceId}
            layout
            className="hand-back"
            style={{ marginLeft: index === 0 ? 0 : -13, zIndex: index }}
            initial={{ opacity: 0, y: -14, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={SPRING}
          />
        ))}
      </AnimatePresence>
      {cards.length === 0 && <em>尚未获得</em>}
    </div>
  );
}

/** 资源弹窗里手牌区的可用宽度，与 .resource-modal 的内容宽度保持一致 */
const RESOURCE_RAIL_WIDTH = 520;

/**
 * 资源弹窗：地图阶段查看持有的卷轴和装备。
 *
 * 规格 25.2 要求侧栏只显示卷轴「数量」，完整手牌不摊在常驻界面上，
 * 所以放进按需打开的弹窗。卷轴用扇形排布，几何计算见 anim/handLayout.ts。
 */
function ResourceModal({ player, playback, onClose }: {
  player: PlayerView;
  playback: Playback;
  onClose: () => void;
}) {
  // 只有看得见牌面的才铺开；对手的手牌在视图里已是牌背，这里拿不到牌名
  const cards = visibleScrolls(revealedScrolls(player, playback));
  const hiddenCount = revealedScrolls(player, playback).length - cards.length;
  const spacing = handSpacing(cards.length, RESOURCE_RAIL_WIDTH);

  return (
    <ModalBackdrop className="resource-backdrop" onClick={onClose}>
      <motion.section
        className="resource-modal"
        style={{ "--player-color": player.color } as React.CSSProperties}
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-kicker">持有资源</div>
        <h2>{player.name}</h2>

        <h3 className="resource-heading">
          卷轴手牌 <span>{cards.length + hiddenCount} 张</span>
        </h3>
        {hiddenCount > 0 && (
          <p className="resource-hidden-note">对手的手牌不可见，只能看到张数。</p>
        )}
        <div className={`hand-rail ${cards.length === 0 ? "empty" : ""}`}>
          <AnimatePresence initial={false} mode="popLayout">
            {cards.map((scroll, index) => {
              // 绕卡面下方的支点旋转形成扇形
              const { rotate, lift, zIndex } = handCardLayout(index, cards.length);
              return (
                <motion.article
                  key={scroll.instanceId}
                  layout
                  className={`hand-card scroll-${scroll.kind}`}
                  style={{ marginLeft: index === 0 ? 0 : spacing, zIndex }}
                  initial={{ opacity: 0, y: 60, scale: 0.7, rotate: 0 }}
                  animate={{ opacity: 1, y: lift, scale: 1, rotate }}
                  exit={{ opacity: 0, y: -60, scale: 0.6, transition: { duration: 0.24 } }}
                  whileHover={{ y: lift - 24, rotate: 0, scale: 1.09, zIndex: 60 }}
                  transition={SPRING}
                >
                  <span className={`card-rarity rarity-${SCROLLS[scroll.kind].rarity.toLowerCase()}`}>
                    {SCROLLS[scroll.kind].rarity}
                  </span>
                  <span className="hand-card-sigil">{SCROLLS[scroll.kind].sigil}</span>
                  <span className="hand-card-name">{SCROLLS[scroll.kind].name}</span>
                  <span className="hand-card-effect">{SCROLLS[scroll.kind].description}</span>
                </motion.article>
              );
            })}
          </AnimatePresence>
          {cards.length === 0 && (
            <p className="hand-empty">{hiddenCount > 0 ? `${hiddenCount} 张暗牌` : "尚未获得卷轴"}</p>
          )}
        </div>

        <h3 className="resource-heading">装备 <span>{player.equipment.length} 件</span></h3>
        <div className="chips resource-chips">
          {player.equipment.length === 0 && <em>尚未获得</em>}
          {player.equipment.map((item) => (
            <span className="chip equipment" key={item.instanceId}>
              {EQUIPMENT[item.kind].rarity} · {EQUIPMENT[item.kind].name}
              <i>{EQUIPMENT[item.kind].description}</i>
            </span>
          ))}
        </div>

        <button className="primary-button secondary" onClick={onClose}>关闭</button>
      </motion.section>
    </ModalBackdrop>
  );
}

function choiceOf(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.choiceA : battle.choiceB;
}

/**
 * 当前轮到哪一侧选卷轴：攻击方先（GameRule 7.7 第 4 步），再防守方（第 5 步）。
 * 两侧都提交后返回 null，引擎会自动结算本回合。
 */
function pendingChoiceSide(battle: BattleState): CombatSide | null {
  const attacker = battle.attacker;
  const defender: CombatSide = attacker === "a" ? "b" : "a";
  if (choiceOf(battle, attacker).status === "pending") return attacker;
  if (choiceOf(battle, defender).status === "pending") return defender;
  return null;
}

/**
 * 战斗中的可用卷轴（规格 25.5「可使用卷轴」）。
 *
 * 按 timing 过滤而不是按 kind，加新卷轴时这里不用改（GameRule 8.9）。
 * 单选状态天然满足 8.5「每个角色一次攻击回合最多使用一张卷轴」。
 */
function BattleHand({ player, timing, label, selectedId, onSelect, disabled }: {
  player: PlayerView;
  timing: ScrollTiming;
  label: string;
  selectedId: string;
  onSelect: (instanceId: string) => void;
  disabled: boolean;
}) {
  const cards = playableFromView(player, timing);

  return (
    <div className="battle-hand">
      <span className="battle-hand-label">{label}</span>
      {cards.length === 0 ? (
        <em className="battle-hand-empty">无可用卷轴</em>
      ) : (
        <div className="battle-hand-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {cards.map((scroll) => {
              const selected = scroll.instanceId === selectedId;
              return (
                <motion.button
                  key={scroll.instanceId}
                  layout
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`battle-card scroll-${scroll.kind} ${selected ? "selected" : ""}`}
                  onClick={() => onSelect(selected ? "" : scroll.instanceId)}
                  initial={{ opacity: 0, y: 18, scale: 0.8 }}
                  animate={{ opacity: 1, y: selected ? -9 : 0, scale: selected ? 1.05 : 1 }}
                  exit={{ opacity: 0, y: -26, scale: 0.6, transition: { duration: 0.24 } }}
                  whileHover={disabled ? undefined : { y: selected ? -13 : -6 }}
                  transition={SPRING}
                >
                  <span className={`card-rarity rarity-${SCROLLS[scroll.kind].rarity.toLowerCase()}`}>
                    {SCROLLS[scroll.kind].rarity}
                  </span>
                  <span className="battle-card-name">{SCROLLS[scroll.kind].name}</span>
                  <span className="battle-card-effect">{SCROLLS[scroll.kind].description}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function PlayerPanel({ player, active, destination, playback, onInspect }: {
  player: PlayerView;
  active: boolean;
  destination: number;
  playback: Playback;
  onInspect: () => void;
}) {
  const hp = visualHp(player, playback.pending);
  const maxHp = visualMaxHp(player, playback.pending);
  const position = visualPosition(player, playback.pending);
  const equipment = player.equipment.filter((item) =>
    isRevealed(item.instanceId, playback.pending),
  );

  return (
    <motion.aside
      className={`player-panel ${active ? "active" : ""}`}
      style={{ "--player-color": player.color } as React.CSSProperties}
      animate={{ scale: active ? 1 : 0.99 }}
      transition={SPRING}
    >
      <div className="player-heading">
        <span className="player-sigil">{player.id === "player1" ? "焰" : "潮"}</span>
        <div>
          <span className="eyebrow">{active ? "当前行动" : "登山者"}</span>
          <h2>{player.name}</h2>
        </div>
      </div>
      <div className="hp-row">
        <span>生命</span><strong>{hp}/{maxHp}</strong>
      </div>
      <HealthBar value={hp} max={maxHp} />
      <div className="stat-grid">
        <div><span>攻击</span><strong>{getAttack(player)}</strong></div>
        <div><span>防御</span><strong>{getDefense(player)}</strong></div>
        <div><span>进度</span><strong>{position}/{destination}</strong></div>
      </div>
      {/* 规格 25.2：侧栏只给卷轴数量，完整手牌走资源弹窗 */}
      <div className="inventory-block">
        <h3>卷轴 <span>{player.scrolls.length}</span></h3>
        <HandBacks player={player} playback={playback} />
      </div>
      <div className="inventory-block">
        <h3>装备 <span>{player.equipment.length}</span></h3>
        <div className="chips">
          {equipment.length === 0 && <em>尚未获得</em>}
          <AnimatePresence initial={false} mode="popLayout">
            {equipment.map((item) => (
              <motion.span
                className="chip equipment"
                key={item.instanceId}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={SPRING}
              >
                {EQUIPMENT[item.kind].name}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <button className="ghost-button inspect-button" onClick={onInspect}>查看资源</button>
    </motion.aside>
  );
}

const MIN_BOARD_ZOOM = 0.22;
const MAX_BOARD_ZOOM = 1.6;

interface BoardTransform {
  x: number;
  y: number;
  scale: number;
}

function Board({ state, playback }: { state: GameStateView; playback: Playback }) {
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

function CombatSlot({ label, dice, sides = 6, total }: {
  label: string;
  dice?: number[];
  sides?: number;
  total?: number;
}) {
  return (
    <div className="combat-slot">
      <span className="combat-slot-label">{label} D{sides}</span>
      <AnimatePresence mode="wait">
        {dice === undefined ? (
          <motion.span className="combat-die idle" key="idle">—</motion.span>
        ) : (
          <motion.div
            className="combat-rolls"
            key={`${label}-${dice.join("-")}-${total}`}
            initial={{ scale: 0.2, rotate: -160, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
          >
            {dice.map((die, index) => (
              <span className="combat-die" key={`${index}-${die}`}>{die}</span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <span className="combat-slot-total">{total === undefined ? "" : `合计 ${total}`}</span>
    </div>
  );
}

function BattlePanel({ state, battle, dispatch, playback, viewerSeat }: {
  state: GameStateView;
  battle: BattleState;
  dispatch: Dispatch;
  playback: Playback;
  viewerSeat: PlayerId;
}) {
  const [pendingChoiceId, setPendingChoiceId] = useState("");
  const [rolls, setRolls] = useState<{
    attackDice?: number[]; attackSides?: number; attackTotal?: number;
    defenseDice?: number[]; defenseSides?: number; defenseTotal?: number;
  }>({});
  const { a, b } = getBattleParticipants(state, battle);
  const attackerSide = battle.attacker;
  const defenderSide: CombatSide = attackerSide === "a" ? "b" : "a";

  // 依次轮到谁选牌：攻击方先（7.7 第 4 步），再防守方（第 5 步）
  const choosingSide = pendingChoiceSide(battle);
  const choosingPlayer = choosingSide ? getSidePlayer(state, battle, choosingSide) : undefined;
  const choosingTiming: ScrollTiming =
    choosingSide === attackerSide ? "beforeAttackRoll" : "beforeDefenseRoll";
  const otherSideSubmitted =
    choosingSide !== null &&
    choiceOf(battle, choosingSide === "a" ? "b" : "a").status !== "pending";
  // 该选牌的人是不是"我"。不是的话只显示等待，绝不能把对方的手牌铺出来
  const myTurnToChoose = choosingPlayer?.id === viewerSeat;

  useEffect(() => {
    setPendingChoiceId("");
    setRolls({});
  }, [battle.round]);

  // 换一方选牌时清空选择，免得把上一方的选中态带过去
  useEffect(() => {
    setPendingChoiceId("");
  }, [choosingSide]);

  // 攻防骰事件播到时才亮出骰面，让数字跟动画同步出现
  const playing = playback.event;
  useEffect(() => {
    if (playing?.type === "attackRolled") {
      setRolls((current) => ({
        ...current,
        attackDice: playing.dice,
        attackSides: playing.sides,
        attackTotal: playing.total,
      }));
    }
    if (playing?.type === "defenseRolled") {
      setRolls((current) => ({
        ...current,
        defenseDice: playing.dice,
        defenseSides: playing.sides,
        defenseTotal: playing.total,
      }));
    }
  }, [playing]);

  const nameOf = (side: CombatSide) => (side === "a" ? a.name : b.name);
  const hpMaxB = "maxHp" in b ? b.maxHp : 1;
  const hpA = visualBattleHp(battle, "a", playback.pending);
  const hpB = visualBattleHp(battle, "b", playback.pending);
  const damage = activeDamage(playback.event);

  return (
    <ModalBackdrop>
      <motion.section
        className="battle-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">{battle.kind === "pvp" ? "旅者相遇战" : battle.kind === "boss" ? "最终决战" : "山路遭遇"}</div>
        <h2>{a.name} <span>VS</span> {b.name}</h2>
        <div className="initiative-line">先攻投骰 {battle.initiativeA} : {battle.initiativeB} · 第 {battle.round} 轮</div>
        <div className="combatants">
          <div className={attackerSide === "a" ? "attacking" : ""}>
            <span className="combat-role">{attackerSide === "a" ? "正在攻击" : "防守"}</span>
            <h3>{a.name}</h3>
            <strong>{hpA}/{a.maxHp}</strong>
            <HealthBar value={hpA} max={a.maxHp} />
            <AnimatePresence>
              {damage?.targetSide === "a" && damage.amount > 0 && (
                <motion.span
                  className="damage-float"
                  key={damage.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  −{damage.amount}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="clash-mark">⚔</div>
          <div className={attackerSide === "b" ? "attacking" : ""}>
            <span className="combat-role">{attackerSide === "b" ? "正在攻击" : "防守"}</span>
            <h3>{b.name}</h3>
            <strong>{hpB}/{hpMaxB}</strong>
            <HealthBar value={hpB} max={hpMaxB} />
            <AnimatePresence>
              {damage?.targetSide === "b" && damage.amount > 0 && (
                <motion.span
                  className="damage-float"
                  key={damage.id}
                  initial={{ opacity: 0, y: 6, scale: 0.5 }}
                  animate={{ opacity: 1, y: -40, scale: 1.3 }}
                  exit={{ opacity: 0, y: -62 }}
                  transition={{ duration: 0.5 }}
                >
                  −{damage.amount}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="combat-dice">
          <CombatSlot label="攻击" dice={rolls.attackDice} sides={rolls.attackSides} total={rolls.attackTotal} />
          <CombatSlot label="防御" dice={rolls.defenseDice} sides={rolls.defenseSides} total={rolls.defenseTotal} />
        </div>

        <p className="turn-callout"><strong>{nameOf(attackerSide)}</strong>发动攻击，{nameOf(defenderSide)}进行防御。</p>

        {/*
          规格 8.3：双方必须在看到骰子结果之前决定是否使用卷轴。
          暗牌之下两人不能同屏选牌，所以改成依次提交——先攻击方（7.7 第 4 步）
          再防守方（第 5 步），两侧齐了引擎自动结算。
        */}
        {choosingPlayer && choosingSide && myTurnToChoose && (
          <>
            <p className="scroll-notice">
              轮到<strong>{choosingPlayer.name}</strong>决定是否使用卷轴，最多一张。
              {otherSideSubmitted && <span className="submitted-hint">对方已提交</span>}
            </p>
            <BattleHand
              player={choosingPlayer}
              timing={choosingTiming}
              label={choosingSide === attackerSide ? "攻击方" : "防守方"}
              selectedId={pendingChoiceId}
              onSelect={setPendingChoiceId}
              disabled={playback.playing}
            />
            <button
              className="primary-button battle-button"
              disabled={playback.playing}
              onClick={() => dispatch({
                type: "submitScrollChoice",
                side: choosingSide,
                instanceId: pendingChoiceId || undefined,
              })}
            >
              {pendingChoiceId ? "使用并确认" : "不使用，确认"}
            </button>
          </>
        )}
        {choosingPlayer && !myTurnToChoose && (
          <p className="waiting-notice">
            等待<strong>{choosingPlayer.name}</strong>决定是否使用卷轴……
          </p>
        )}
        <div className="battle-log">
          {battle.log.map((entry, index) => <p key={`${battle.round}-${index}`}>{entry}</p>)}
        </div>
      </motion.section>
    </ModalBackdrop>
  );
}

function PenaltyPanel({ state, penalty, dispatch, playing }: {
  state: GameStateView;
  penalty: PvpPenaltyState;
  dispatch: Dispatch;
  playing: boolean;
}) {
  const winner = state.players[penalty.winnerId];
  const loser = state.players[penalty.loserId];
  const hpAmount = Math.min(3, winner.maxHp - winner.hp, loser.hp - 1);
  return (
    <ModalBackdrop>
      <motion.section
        className="penalty-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">相遇战代价</div>
        <h2>{loser.name}选择交付</h2>
        <p>胜者是{winner.name}。生命已经回溯，战斗中消耗的卷轴不会返还。</p>
        <div className="penalty-options">
          {/* 代价由败方来付，视图里正是他自己的手牌，所以牌面可见 */}
          {visibleScrolls(loser.scrolls).map((item) => (
            <button key={item.instanceId} disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "scroll", instanceId: item.instanceId })}>
              <span>交出卷轴</span><strong>{SCROLLS[item.kind].name}</strong>
            </button>
          ))}
          {loser.equipment.map((item) => (
            <button key={item.instanceId} disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "equipment", instanceId: item.instanceId })}>
              <span>交出装备</span><strong>{EQUIPMENT[item.kind].name}</strong>
            </button>
          ))}
          {hpAmount > 0 && (
            <button disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "hp" })}>
              <span>转移生命</span><strong>{hpAmount} 点生命</strong>
            </button>
          )}
        </div>
      </motion.section>
    </ModalBackdrop>
  );
}

function EquipmentChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: EquipmentChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const definition = EQUIPMENT[choice.offered.kind];
  const category = equipmentCategory(choice.offered.kind);
  const replaceable = player.equipment.filter(
    (item) => equipmentCategory(item.kind) === category,
  );
  const canChoose = viewerSeat === choice.playerId;

  return (
    <ModalBackdrop>
      <motion.section
        className="equipment-choice-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">装备槽已满</div>
        <h2>{player.name}获得了{definition.name}</h2>
        <div className="offered-equipment">
          <span>{definition.rarity} · {EQUIPMENT_CATEGORY_NAMES[category]}</span>
          <strong>{definition.name}</strong>
          <p>{definition.description}</p>
        </div>
        {canChoose ? (
          <>
            <p>选择一件同类装备替换，或放弃这件新装备。</p>
            <div className="equipment-choice-options">
              {replaceable.map((item) => (
                <button
                  key={item.instanceId}
                  disabled={playing}
                  onClick={() => dispatch({
                    type: "chooseEquipment",
                    replaceInstanceId: item.instanceId,
                  })}
                >
                  <span>替换</span>
                  <strong>{EQUIPMENT[item.kind].name}</strong>
                  <small>{EQUIPMENT[item.kind].description}</small>
                </button>
              ))}
              <button
                className="discard-equipment"
                disabled={playing}
                onClick={() => dispatch({ type: "chooseEquipment" })}
              >
                <span>不替换</span>
                <strong>放弃新装备</strong>
              </button>
            </div>
          </>
        ) : (
          <p className="waiting-notice">等待{player.name}选择装备……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

function GameOverPanel({ winner, dispatch }: { winner: PlayerView; dispatch: Dispatch }) {
  return (
    <ModalBackdrop className="victory-backdrop">
      <motion.section
        className="victory-modal"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
      >
        <motion.span
          className="crown"
          initial={{ y: -30, rotate: -20, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 14 }}
        >♛</motion.span>
        <div className="modal-kicker">登峰之冠</div>
        <h2>{winner.name}获胜</h2>
        <p>巨龙已经倒下，山巅见证了新的冠军。</p>
        <button className="primary-button" onClick={() => dispatch({ type: "restart" })}>再来一局</button>
      </motion.section>
    </ModalBackdrop>
  );
}

function ActionDock({ state, dispatch, message, playback }: {
  state: GameStateView;
  dispatch: Dispatch;
  message: string;
  playback: Playback;
}) {
  const active = state.players[state.activePlayerId];
  // 投骰事件播到之前先不亮骰面，免得数字比动画早一步出现
  const rollPending = playback.pending.some((event) => event.type === "movementRolled");
  const die = rollPending ? undefined : state.lastMovementRoll;
  const movementSides = Math.max(2, 6 + getDieSidesBonus(active, "movement"));

  return (
    <section className="action-dock">
      <div>
        <span className="eyebrow">行动提示</span>
        <AnimatePresence mode="wait">
          <motion.p
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
          {state.phase.kind === "awaitingRoll" && (
            <button className="primary-button" onClick={() => dispatch({ type: "rollMovement" })}>为{active.name}投 D{movementSides}</button>
          )}
          {state.phase.kind === "turnComplete" && (
            <button className="primary-button secondary" onClick={() => dispatch({ type: "endTurn" })}>结束回合</button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 对局界面。本地热座与联机共用同一套——两者的差别只在于：
 * 状态从哪来（本地 reducer / 服务器推送）、以及观看者是谁。
 *
 * `viewerSeat` 决定"我是谁"：本地模式是当前该操作的人（传设备），
 * 联机模式是自己的座位。手牌可见性完全由它决定。
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
  const activeName = state.players[state.activePlayerId].name;

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
        />
        <Board state={state} playback={playback} />
        <PlayerPanel
          player={state.players.player2}
          active={state.activePlayerId === "player2"}
          destination={state.map.tiles.length - 1}
          playback={playback}
          onInspect={() => setInspecting("player2")}
        />
      </div>

      <ActionDock state={state} dispatch={dispatch} message={dockMessage} playback={playback} />
      <details className="history-panel">
        <summary>冒险记录</summary>
        {state.history.map((entry, index) => <p key={`${index}-${entry.text}`}>{entry.text}</p>)}
      </details>

      {/* 三个弹层放在同一个 AnimatePresence 下，阶段切换时才有进退场衔接 */}
      <AnimatePresence mode="wait">
        {state.phase.kind === "battle" && (
          <BattlePanel
            key="battle"
            state={state}
            battle={state.phase.battle}
            dispatch={dispatch}
            playback={playback}
            viewerSeat={viewerSeat}
          />
        )}
        {state.phase.kind === "pvpPenalty" && (
          <PenaltyPanel key="penalty" state={state} penalty={state.phase.penalty} dispatch={dispatch} playing={playback.playing} />
        )}
        {state.phase.kind === "equipmentChoice" && (
          <EquipmentChoicePanel
            key="equipment-choice"
            state={state}
            choice={state.phase.choice}
            dispatch={dispatch}
            playing={playback.playing}
            viewerSeat={viewerSeat}
          />
        )}
        {state.phase.kind === "gameOver" && (
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
            onClose={() => setInspecting(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
