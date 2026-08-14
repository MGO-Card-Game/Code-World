import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { railMetrics, railSelectionGap } from "../anim/handRail";
import { EQUIPMENT, equipmentKeywords, type EquipmentKind } from "../game/content/equipment";
import { blessingDefinition } from "../game/content/blessings";
import { blessingCapacity } from "../game/blessings";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  scrollCategory,
  scrollDefinition,
  scrollKeywords,
  type ScrollDefinition,
} from "../game/content/scrolls";
import { regionForPosition } from "../game/map";
import { getDieSidesBonus } from "../game/selectors";
import type { GameMap, PlayerView } from "../game/types";
import {
  blurbText,
  CardBlurb,
  ModalBackdrop,
  revealedScrolls,
  RuleText,
  SPRING,
  visibleScrolls,
  type Playback,
} from "./shared";

type MapUsePhase = "awaitingRoll" | "turnComplete" | undefined;

/** 本身就是一次移动的卷轴：需要先配置点数或目标格，不能一键使用。 */
function movementEffectOf(definition: ScrollDefinition) {
  return definition.effects.find(
    (effect) => effect.type === "chooseMovement" || effect.type === "teleport",
  );
}

function isAnywhereDoor(definition: ScrollDefinition) {
  return definition.effects.some((effect) => effect.type === "teleportAnywhere");
}

function needsMovementConfiguration(definition: ScrollDefinition) {
  return !!movementEffectOf(definition) || isAnywhereDoor(definition);
}

function replacesMovement(definition: ScrollDefinition) {
  return scrollKeywords(definition).includes("replacesMovement");
}

/**
 * 选中的卷轴此刻能不能在地图阶段使用。
 *
 * 不能用时给出可以直接读的原因：操作区把它显示成一行说明，而不是塞进按钮的 title——
 * 悬浮才看得见的提示，对一个已经禁用的按钮没有意义。
 */
function mapUseState(
  definition: ScrollDefinition,
  player: Pick<PlayerView, "hp" | "maxHp" | "position" | "previousStopPosition">,
  mapUsePhase: MapUsePhase,
): { usable: boolean; reason?: string } {
  if (!definition.timings.includes("map")) return { usable: false, reason: "只能在战斗中使用" };
  if (!mapUsePhase) return { usable: false, reason: "现在不是你的地图阶段" };
  const heals = definition.effects.some(
    (effect) => effect.type === "heal" && effect.amount > 0,
  );
  if (heals && player.hp >= player.maxHp) return { usable: false, reason: "生命已满" };
  const forfeitsMovement = definition.effects.some(
    (effect) => effect.type === "forfeitMovement",
  );
  if (forfeitsMovement && mapUsePhase === "turnComplete") {
    return { usable: false, reason: "已经移动，不能再放弃移动" };
  }
  if (replacesMovement(definition) && mapUsePhase !== "awaitingRoll") {
    return { usable: false, reason: "本回合已经移动，不能再使用这张牌" };
  }
  const retraces = definition.effects.some((effect) => effect.type === "returnToPreviousPosition");
  if (
    retraces
    && (player.previousStopPosition === undefined || player.previousStopPosition === player.position)
  ) {
    return { usable: false, reason: "还没有可折返的上一次停留位置" };
  }
  return { usable: true };
}

/**
 * 资源弹窗：地图阶段查看持有的卷轴和装备。
 *
 * 规格 25.2 要求侧栏只显示卷轴「数量」，完整手牌不摊在常驻界面上，所以放进按需打开
 * 的弹窗。手牌分成「浏览」和「执行」两层：卷轴平铺成横向手牌栏，只负责选中；使用、
 * 取消和移动配置都在上方一块位置固定的操作区里。
 *
 * 之所以不把「使用」按钮放回卡面上：手牌栏在 7 张以后就开始重叠，卡上的小按钮会被
 * 邻牌压住大半；再叠上悬浮抬升，按钮还会主动躲开正伸过去的鼠标。排布几何见
 * anim/handRail.ts。
 */
export function ResourceModal({
  player,
  map,
  playback,
  onClose,
  onInspectEquipment,
  mapUsePhase,
  onUseMapScroll,
}: {
  player: PlayerView;
  map: GameMap;
  playback: Playback;
  onClose: () => void;
  onInspectEquipment: (kind: EquipmentKind) => void;
  mapUsePhase?: "awaitingRoll" | "turnComplete";
  onUseMapScroll: (instanceId: string, distance?: number, targetPosition?: number) => void;
}) {
  // 只有看得见牌面的才铺开；对手的手牌在视图里已是牌背，这里拿不到牌名
  const cards = visibleScrolls(revealedScrolls(player, playback));
  const hiddenCount = revealedScrolls(player, playback).length - cards.length;
  const metrics = railMetrics(cards.length);
  const selectionGap = railSelectionGap(metrics.spacing);
  // 灵活行动/短程传送符/触手可得这类卡需要玩家先选点数再使用，按卡实例各记一份待选值
  const [pendingDistance, setPendingDistance] = useState<Record<string, number>>({});
  // 任意门：待选的绝对格子编号，同样按卡实例各记一份
  const [pendingTarget, setPendingTarget] = useState<Record<string, number>>({});
  // 选中态是这一区唯一的操作入口：卡面只负责被选，使用与配置都交给上方的操作区。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const movementSides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
  const currentRegion = regionForPosition(map, player.position);
  const selectedIndex = cards.findIndex((scroll) => scroll.instanceId === selectedId);
  const selected = selectedIndex >= 0 ? cards[selectedIndex] : undefined;
  const configuringDefinition = selected ? scrollDefinition(selected.kind) : undefined;
  const mapUse = configuringDefinition
    ? mapUseState(configuringDefinition, player, mapUsePhase)
    : undefined;
  const configuringMovementEffect = configuringDefinition
    ? movementEffectOf(configuringDefinition)
    : undefined;
  const configuringAnywhereDoor = configuringDefinition
    ? isAnywhereDoor(configuringDefinition)
    : false;
  // 配置器只在这张卡真的能用时展开，否则步进器调半天最后还是按不下去
  const configuring = !!selected && !!mapUse?.usable
    && !!configuringDefinition && needsMovementConfiguration(configuringDefinition);
  const configuringMaxDistance = configuringMovementEffect
    ? configuringMovementEffect.type === "chooseMovement"
      ? movementSides
      : configuringMovementEffect.maxDistance
    : undefined;
  const configuredDistance = selected && configuringMaxDistance
    ? Math.min(
        configuringMaxDistance,
        Math.max(1, pendingDistance[selected.instanceId] ?? configuringMaxDistance),
      )
    : undefined;
  const configuredTarget = selected && configuringAnywhereDoor
    ? Math.min(
        currentRegion.endIndex,
        Math.max(
          currentRegion.startIndex,
          pendingTarget[selected.instanceId] ?? player.position,
        ),
      )
    : undefined;
  const previewDistance = configuredDistance ?? 0;
  const previewPosition = configuredTarget ?? (
    currentRegion.startIndex
    + ((player.position - currentRegion.startIndex + previewDistance) % (currentRegion.endIndex - currentRegion.startIndex + 1))
  );
  const previewTile = map.tiles[previewPosition];

  // 手牌多到要滚动时，自动选中相邻卡可能把选中项换到视野外，得跟着滚回来
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId]);

  // 竖着滚滚轮就横向翻牌。手牌栏嵌在会纵向滚动的弹窗里，不拦下来两层会一起动
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !metrics.scrollable) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaY;
    };
    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => rail.removeEventListener("wheel", onWheel);
  }, [metrics.scrollable]);

  const useSelected = () => {
    if (!selected || !mapUse?.usable) return;
    if (configuring) {
      onUseMapScroll(selected.instanceId, configuredDistance, configuredTarget);
      onClose();
      return;
    }
    // 用掉一张后顺势选中相邻的一张，连着用几张不必每次重新找位置
    const next = cards[selectedIndex + 1] ?? cards[selectedIndex - 1];
    onUseMapScroll(selected.instanceId);
    setSelectedId(next?.instanceId ?? null);
  };

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
        {/*
          操作区常驻，不随选中出现或消失：它一撑高一收窄，下面的手牌栏就会在鼠标底下
          上下跳，重构要解决的正是这类"控件自己跑掉"的问题。
        */}
        <div className="scroll-action-bar">
          {selected && configuringDefinition && mapUse ? (
            <>
              <div className="movement-config-copy">
                <span>
                  {configuringDefinition.rarity}
                  {" · "}
                  {SCROLL_CATEGORY_NAMES[scrollCategory(configuringDefinition)]}
                </span>
                <strong>{configuringDefinition.name}</strong>
                <small>
                  <CardBlurb
                    keywords={scrollKeywords(configuringDefinition)}
                    description={configuringDefinition.description}
                  />
                </small>
                {mapUse.reason && (
                  <em className="scroll-action-reason">{mapUse.reason}</em>
                )}
              </div>

              {configuring && configuringMovementEffect && configuredDistance !== undefined && configuringMaxDistance !== undefined && (
                <div className="movement-stepper" aria-label="选择移动格数">
                  <button
                    type="button"
                    aria-label="减少格数"
                    disabled={configuredDistance <= 1}
                    onClick={() => setPendingDistance((previous) => ({
                      ...previous,
                      [selected.instanceId]: Math.max(1, configuredDistance - 1),
                    }))}
                  >
                    −
                  </button>
                  <div>
                    <strong>{configuredDistance}</strong>
                    <span>格</span>
                  </div>
                  <button
                    type="button"
                    aria-label="增加格数"
                    disabled={configuredDistance >= configuringMaxDistance}
                    onClick={() => setPendingDistance((previous) => ({
                      ...previous,
                      [selected.instanceId]: Math.min(
                        configuringMaxDistance,
                        configuredDistance + 1,
                      ),
                    }))}
                  >
                    ＋
                  </button>
                </div>
              )}

              {configuring && configuringAnywhereDoor && configuredTarget !== undefined && (
                <div className="movement-stepper movement-target-stepper" aria-label="选择目标格">
                  <button
                    type="button"
                    aria-label="目标格前移"
                    disabled={configuredTarget <= currentRegion.startIndex}
                    onClick={() => setPendingTarget((previous) => ({
                      ...previous,
                      [selected.instanceId]: Math.max(
                        currentRegion.startIndex,
                        configuredTarget - 1,
                      ),
                    }))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    aria-label="目标格编号"
                    min={currentRegion.startIndex}
                    max={currentRegion.endIndex}
                    value={configuredTarget}
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      if (!Number.isInteger(raw)) return;
                      setPendingTarget((previous) => ({
                        ...previous,
                        [selected.instanceId]: Math.min(
                          currentRegion.endIndex,
                          Math.max(currentRegion.startIndex, raw),
                        ),
                      }));
                    }}
                  />
                  <button
                    type="button"
                    aria-label="目标格后移"
                    disabled={configuredTarget >= currentRegion.endIndex}
                    onClick={() => setPendingTarget((previous) => ({
                      ...previous,
                      [selected.instanceId]: Math.min(
                        currentRegion.endIndex,
                        configuredTarget + 1,
                      ),
                    }))}
                  >
                    ＋
                  </button>
                </div>
              )}

              {configuring && (
                <div className="movement-preview">
                  <span>预计落点</span>
                  <strong>{String(previewPosition).padStart(2, "0")} · {previewTile?.label ?? "未知格子"}</strong>
                </div>
              )}

              <div className="movement-config-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setSelectedId(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!mapUse.usable}
                  onClick={useSelected}
                >
                  {configuring ? "确认使用" : "立即使用"}
                </button>
              </div>
            </>
          ) : (
            <p className="scroll-action-hint">
              {cards.length > 0
                ? "选择下方任意一张卷轴，这里会显示完整说明与使用按钮。"
                : hiddenCount > 0
                  ? "对手的手牌只能看到张数。"
                  : "手上还没有卷轴。"}
            </p>
          )}
        </div>

        <div className={`hand-rail ${cards.length === 0 ? "empty" : ""}`} ref={railRef}>
          <div className="hand-rail-track" style={{ width: metrics.width }}>
            <AnimatePresence initial={false} mode="popLayout">
              {cards.map((scroll, index) => {
                const definition = scrollDefinition(scroll.kind);
                const category = scrollCategory(definition);
                const isSelected = scroll.instanceId === selectedId;
                /*
                  marginLeft 管的是这张和前一张之间的缝，所以选中卡要让位两次：
                  它自己的 marginLeft 让开左边，后一张的 marginLeft 让开右边。
                */
                const previousSelected = index > 0
                  && cards[index - 1].instanceId === selectedId;
                const marginLeft = index === 0
                  ? 0
                  : metrics.spacing + (isSelected || previousSelected ? selectionGap : 0);
                return (
                  <motion.button
                    key={scroll.instanceId}
                    ref={isSelected ? selectedRef : undefined}
                    layout
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${definition.name}：${blurbText(scrollKeywords(definition), definition.description)}`}
                    className={`hand-card scroll-${scroll.kind} card-${category} ${isSelected ? "selected" : ""} ${needsMovementConfiguration(definition) ? "movement-configurable" : ""}`}
                    style={{ marginLeft, zIndex: isSelected ? 60 : index }}
                    onClick={() => setSelectedId(isSelected ? null : scroll.instanceId)}
                    initial={{ opacity: 0, y: 40, scale: 0.8 }}
                    animate={{ opacity: 1, y: isSelected ? -10 : 0, scale: isSelected ? 1.04 : 1 }}
                    exit={{ opacity: 0, y: -40, scale: 0.7, transition: { duration: 0.24 } }}
                    // 选中卡不再跟随悬浮变化，位置是稳的；未选中的只轻抬 6px 作为反馈
                    whileHover={isSelected ? undefined : { y: -6 }}
                    transition={SPRING}
                  >
                    <span className={`card-rarity rarity-${definition.rarity.toLowerCase()}`}>
                      {definition.rarity}
                    </span>
                    {/* 圆圈标的是卡牌类型（攻击／防守／通用），不是牌名简称 */}
                    <span
                      className={`hand-card-sigil type-${category}`}
                      title={SCROLL_CATEGORY_NAMES[category]}
                    >
                      {SCROLL_CATEGORY_SIGILS[category]}
                    </span>
                    <span className="hand-card-name">{definition.name}</span>
                    <span className="hand-card-effect">
                      <CardBlurb
                        keywords={scrollKeywords(definition)}
                        description={definition.description}
                      />
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
          {cards.length === 0 && (
            <p className="hand-empty">{hiddenCount > 0 ? `${hiddenCount} 张暗牌` : "尚未获得卷轴"}</p>
          )}
        </div>
        {metrics.scrollable && (
          <p className="hand-rail-position">
            {selected
              ? `${selectedIndex + 1} / ${cards.length}`
              : `${cards.length} 张 · 滚轮或拖动查看`}
          </p>
        )}

        <h3 className="resource-heading">装备 <span>{player.equipment.length} 件</span></h3>
        <div className="chips resource-chips">
          {player.equipment.length === 0 && <em>尚未获得</em>}
          {player.equipment.map((item) => (
            <button
              type="button"
              className="chip equipment"
              key={item.instanceId}
              onClick={() => onInspectEquipment(item.kind)}
              aria-label={`查看${EQUIPMENT[item.kind].name}详情`}
            >
              {EQUIPMENT[item.kind].rarity} · {EQUIPMENT[item.kind].name}
              <i>
                <CardBlurb
                  keywords={equipmentKeywords(EQUIPMENT[item.kind])}
                  description={EQUIPMENT[item.kind].description}
                />
              </i>
            </button>
          ))}
        </div>

        <h3 className="resource-heading">
          赐福 <span>{player.blessings.length}/{blessingCapacity(player)} 个</span>
        </h3>
        <div className="chips resource-chips">
          {player.blessings.length === 0 && <em>尚未获得</em>}
          {player.blessings.map((blessing) => {
            const definition = blessingDefinition(blessing.kind);
            return (
              <span className="chip blessing" key={blessing.instanceId}>
                {definition.name}
                <i><RuleText text={definition.description} /></i>
              </span>
            );
          })}
        </div>

        <button className="primary-button secondary" onClick={onClose}>关闭</button>
      </motion.section>
    </ModalBackdrop>
  );
}
