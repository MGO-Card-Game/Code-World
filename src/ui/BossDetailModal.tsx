import { motion } from "framer-motion";
import { enemyDefinition } from "../game/content/enemies";
import {
  enemyDiceCountBonus,
  enemyDieSidesBonus,
  enemyStats,
} from "../game/selectors";
import type { MapRegion } from "../game/types";
import { ModalBackdrop, SPRING } from "./shared";

/** 从阶段地图中央打开的首领情报；只展示公开规则，不受解锁状态限制。 */
export function BossDetailModal({ region, onClose }: {
  region: MapRegion;
  onClose: () => void;
}) {
  const definition = enemyDefinition(region.bossEnemyId);
  const stats = enemyStats(region.bossEnemyId);
  const attackSides = 6 + enemyDieSidesBonus(region.bossEnemyId, undefined, "attack");
  const defenseSides = 6 + enemyDieSidesBonus(region.bossEnemyId, undefined, "defense");
  const attackDice = 1 + enemyDiceCountBonus(region.bossEnemyId, undefined, "attack");
  const defenseDice = 1 + enemyDiceCountBonus(region.bossEnemyId, undefined, "defense");

  return (
    <ModalBackdrop className="boss-detail-backdrop" onClick={onClose}>
      <motion.section
        className="boss-detail-modal"
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={SPRING}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="boss-detail-title"
      >
        <div className="boss-detail-emblem">♛</div>
        <div className="modal-kicker">{region.name} · 首领情报</div>
        <h2 id="boss-detail-title">{definition.name}</h2>

        <div className="boss-detail-stats">
          <div><span>生命</span><strong>{stats.maxHp}</strong></div>
          <div><span>攻击</span><strong>{stats.attack}</strong></div>
          <div><span>防御</span><strong>{stats.defense}</strong></div>
        </div>

        <div className="boss-detail-dice">
          <span>攻击骰 <strong>{attackDice > 1 ? `${attackDice}×` : ""}D${attackSides}</strong></span>
          <span>防御骰 <strong>{defenseDice > 1 ? `${defenseDice}×` : ""}D${defenseSides}</strong></span>
        </div>

        <section className="boss-detail-section">
          <h3>特殊能力</h3>
          {definition.abilities?.length ? definition.abilities.map((ability) => (
            <div className="boss-ability" key={ability.name}>
              <strong>{ability.name}</strong>
              <p>{ability.description}</p>
            </div>
          )) : <p className="boss-detail-empty">无特殊能力</p>}
        </section>

        <section className="boss-detail-section">
          <h3>挑战条件</h3>
          {region.requirements.map((requirement) => (
            <p className="boss-requirement-line" key={`${requirement.type}-${requirement.target}`}>
              {requirement.label}
            </p>
          ))}
        </section>

        <p className="boss-detail-rule">
          战败后恢复至半血并返回本阶段检查点；
          {region.id === "summit" ? "胜利即赢得本局。" : "胜利后进入下一阶段。"}
        </p>
        <button className="primary-button secondary" onClick={onClose}>关闭情报</button>
      </motion.section>
    </ModalBackdrop>
  );
}
