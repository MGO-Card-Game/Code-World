import { AnimatePresence, motion } from "framer-motion";
import {
  isRevealed,
  visualBaseStat,
  visualHp,
  visualMaxHp,
  visualPosition,
} from "../anim/visualState";
import { EQUIPMENT, type EquipmentKind } from "../game/content/equipment";
import { getAttack, getDefense } from "../game/selectors";
import type { PlayerView } from "../game/types";
import { HealthBar, revealedScrolls, SPRING, type Playback } from "./shared";

/** 侧栏里只显示牌背和张数，真正的手牌在资源弹窗里 */
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

export function PlayerPanel({
  player,
  active,
  destination,
  playback,
  onInspect,
  onInspectEquipment,
}: {
  player: PlayerView;
  active: boolean;
  destination: number;
  playback: Playback;
  onInspect: () => void;
  onInspectEquipment: (kind: EquipmentKind) => void;
}) {
  const hp = visualHp(player, playback.pending);
  const maxHp = visualMaxHp(player, playback.pending);
  const position = visualPosition(player, playback.pending);
  const visualPlayer = {
    ...player,
    baseAttack: visualBaseStat(player, "attack", playback.pending),
    baseDefense: visualBaseStat(player, "defense", playback.pending),
  };
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
        <div><span>攻击</span><strong>{getAttack(visualPlayer)}</strong></div>
        <div><span>防御</span><strong>{getDefense(visualPlayer)}</strong></div>
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
              <motion.button
                type="button"
                className="chip equipment"
                key={item.instanceId}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={SPRING}
                onClick={() => onInspectEquipment(item.kind)}
                aria-label={`查看${EQUIPMENT[item.kind].name}详情`}
              >
                {EQUIPMENT[item.kind].name}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <button className="ghost-button inspect-button" onClick={onInspect}>查看资源</button>
    </motion.aside>
  );
}
