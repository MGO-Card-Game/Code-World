import { AnimatePresence, motion } from "framer-motion";
import { handCardLayout, handSpacing } from "../anim/handLayout";
import { EQUIPMENT } from "../game/content/equipment";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  SCROLLS,
  scrollCategory,
} from "../game/content/scrolls";
import type { PlayerView } from "../game/types";
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
export function ResourceModal({ player, playback, onClose }: {
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
              const category = scrollCategory(SCROLLS[scroll.kind]);
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
                  {/* 圆圈标的是卡牌类型（攻击／防守／通用），不是牌名简称 */}
                  <span
                    className={`hand-card-sigil type-${category}`}
                    title={SCROLL_CATEGORY_NAMES[category]}
                  >
                    {SCROLL_CATEGORY_SIGILS[category]}
                  </span>
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
