import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { handCardLayout, handSpacing } from "../anim/handLayout";
import { EQUIPMENT, type EquipmentKind } from "../game/content/equipment";
import { blessingDefinition } from "../game/content/blessings";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  SCROLLS,
  scrollCategory,
  scrollDefinition,
} from "../game/content/scrolls";
import { regionForPosition } from "../game/map";
import { getDieSidesBonus } from "../game/selectors";
import type { GameMap, PlayerView } from "../game/types";
import {
  ModalBackdrop,
  revealedScrolls,
  SPRING,
  visibleScrolls,
  type Playback,
} from "./shared";

/** 手牌区的可用宽度，与 .resource-modal 的内容宽度保持一致 */
const RESOURCE_RAIL_WIDTH = 520;

/**
 * 资源弹窗：地图阶段查看持有的卷轴和装备。
 *
 * 规格 25.2 要求侧栏只显示卷轴「数量」，完整手牌不摊在常驻界面上，
 * 所以放进按需打开的弹窗。卷轴用扇形排布，几何计算见 anim/handLayout.ts。
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
  const spacing = handSpacing(cards.length, RESOURCE_RAIL_WIDTH);
  // 灵活行动/短程传送符/触手可得这类卡需要玩家先选点数再使用，按卡实例各记一份待选值
  const [pendingDistance, setPendingDistance] = useState<Record<string, number>>({});
  // 任意门：待选的绝对格子编号，同样按卡实例各记一份
  const [pendingTarget, setPendingTarget] = useState<Record<string, number>>({});
  const movementSides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
  const currentRegion = regionForPosition(map, player.position);

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
              const definition = scrollDefinition(scroll.kind);
              const category = scrollCategory(definition);
              const mapUsable = definition.timings.includes("map");
              const forfeitsMovement = definition.effects.some(
                (effect) => effect.type === "forfeitMovement",
              );
              const isHealEffect = definition.effects.some(
                (effect) => effect.type === "heal" && effect.amount > 0,
              );
              // 灵活行动/短程传送符/触手可得：本身就是一次移动，只能替代还没掷骰的那一次
              const movementEffect = definition.effects.find(
                (effect) => effect.type === "chooseMovement" || effect.type === "teleport",
              );
              const maxDistance = movementEffect
                ? movementEffect.type === "chooseMovement"
                  ? movementSides
                  : movementEffect.maxDistance
                : undefined;
              const distance = Math.min(
                maxDistance ?? 1,
                Math.max(1, pendingDistance[scroll.instanceId] ?? maxDistance ?? 1),
              );
              // 任意门：目标是当前阶段内的绝对格子编号，不受距离限制
              const isAnywhereDoor = definition.effects.some(
                (effect) => effect.type === "teleportAnywhere",
              );
              const targetPosition = isAnywhereDoor
                ? Math.min(
                    currentRegion.endIndex,
                    Math.max(
                      currentRegion.startIndex,
                      pendingTarget[scroll.instanceId] ?? player.position,
                    ),
                  )
                : undefined;
              const isMovementScroll = !!movementEffect || isAnywhereDoor;
              const mapUseDisabled =
                (isHealEffect && player.hp >= player.maxHp) ||
                (forfeitsMovement && mapUsePhase === "turnComplete") ||
                (isMovementScroll && mapUsePhase !== "awaitingRoll");
              return (
                <motion.article
                  key={scroll.instanceId}
                  layout
                  className={`hand-card scroll-${scroll.kind} card-${category}`}
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
                  {/* 圆圈标的是卡牌类型（攻击／防守／通用），不是牌名简称 */}
                  <span
                    className={`hand-card-sigil type-${category}`}
                    title={SCROLL_CATEGORY_NAMES[category]}
                  >
                    {SCROLL_CATEGORY_SIGILS[category]}
                  </span>
                  <span className="hand-card-name">{SCROLLS[scroll.kind].name}</span>
                  <span className="hand-card-effect">{SCROLLS[scroll.kind].description}</span>
                  {movementEffect && mapUsePhase && (
                    <div className="hand-card-distance">
                      <button
                        type="button"
                        aria-label="减少格数"
                        disabled={mapUseDisabled || distance <= 1}
                        onClick={() =>
                          setPendingDistance((prev) => ({
                            ...prev,
                            [scroll.instanceId]: Math.max(1, distance - 1),
                          }))
                        }
                      >
                        −
                      </button>
                      <span>{distance} 格</span>
                      <button
                        type="button"
                        aria-label="增加格数"
                        disabled={mapUseDisabled || distance >= (maxDistance ?? distance)}
                        onClick={() =>
                          setPendingDistance((prev) => ({
                            ...prev,
                            [scroll.instanceId]: Math.min(maxDistance ?? distance, distance + 1),
                          }))
                        }
                      >
                        ＋
                      </button>
                    </div>
                  )}
                  {isAnywhereDoor && mapUsePhase && (
                    <div className="hand-card-distance hand-card-target">
                      <button
                        type="button"
                        aria-label="目标格前移"
                        disabled={mapUseDisabled || targetPosition! <= currentRegion.startIndex}
                        onClick={() =>
                          setPendingTarget((prev) => ({
                            ...prev,
                            [scroll.instanceId]: Math.max(currentRegion.startIndex, targetPosition! - 1),
                          }))
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        aria-label="目标格编号"
                        min={currentRegion.startIndex}
                        max={currentRegion.endIndex}
                        value={targetPosition}
                        disabled={mapUseDisabled}
                        title={map.tiles[targetPosition!]?.label}
                        onChange={(event) => {
                          const raw = Number(event.target.value);
                          if (!Number.isInteger(raw)) return;
                          setPendingTarget((prev) => ({
                            ...prev,
                            [scroll.instanceId]: Math.min(
                              currentRegion.endIndex,
                              Math.max(currentRegion.startIndex, raw),
                            ),
                          }));
                        }}
                      />
                      <button
                        type="button"
                        aria-label="目标格后移"
                        disabled={mapUseDisabled || targetPosition! >= currentRegion.endIndex}
                        onClick={() =>
                          setPendingTarget((prev) => ({
                            ...prev,
                            [scroll.instanceId]: Math.min(currentRegion.endIndex, targetPosition! + 1),
                          }))
                        }
                      >
                        ＋
                      </button>
                    </div>
                  )}
                  {isAnywhereDoor && mapUsePhase && (
                    <span className="hand-card-target-label">{map.tiles[targetPosition!]?.label}</span>
                  )}
                  {mapUsable && mapUsePhase && (
                    <button
                      type="button"
                      className="hand-card-use"
                      disabled={mapUseDisabled}
                      title={
                        isHealEffect && player.hp >= player.maxHp
                          ? "生命已满"
                          : isMovementScroll && mapUsePhase !== "awaitingRoll"
                            ? "本回合已经移动，无法再指定移动"
                            : mapUseDisabled
                              ? "已经移动后不能使用战地药剂"
                              : undefined
                      }
                      onClick={() =>
                        onUseMapScroll(
                          scroll.instanceId,
                          movementEffect ? distance : undefined,
                          isAnywhereDoor ? targetPosition : undefined,
                        )
                      }
                    >
                      {mapUseDisabled ? "现在不能使用" : "立即使用"}
                    </button>
                  )}
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
            <button
              type="button"
              className="chip equipment"
              key={item.instanceId}
              onClick={() => onInspectEquipment(item.kind)}
              aria-label={`查看${EQUIPMENT[item.kind].name}详情`}
            >
              {EQUIPMENT[item.kind].rarity} · {EQUIPMENT[item.kind].name}
              <i>{EQUIPMENT[item.kind].description}</i>
            </button>
          ))}
        </div>

        <h3 className="resource-heading">赐福 <span>{player.blessings.length} 个</span></h3>
        <div className="chips resource-chips">
          {player.blessings.length === 0 && <em>尚未获得</em>}
          {player.blessings.map((blessing) => {
            const definition = blessingDefinition(blessing.kind);
            return (
              <span className="chip blessing" key={blessing.instanceId}>
                {definition.name}
                <i>{definition.description}</i>
              </span>
            );
          })}
        </div>

        <button className="primary-button secondary" onClick={onClose}>关闭</button>
      </motion.section>
    </ModalBackdrop>
  );
}
