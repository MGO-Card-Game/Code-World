import { motion } from "framer-motion";
import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  type EquipmentKind,
} from "../game/content/equipment";
import { ModalBackdrop, SPRING } from "./shared";

/** 从玩家面板或资源列表点开的一张装备详情卡。 */
export function EquipmentDetailModal({ kind, onClose }: {
  kind: EquipmentKind;
  onClose: () => void;
}) {
  const definition = EQUIPMENT[kind];

  return (
    <ModalBackdrop className="equipment-detail-backdrop" onClick={onClose}>
      <motion.section
        className="equipment-detail-modal"
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 8 }}
        transition={SPRING}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-detail-title"
      >
        <div className="modal-kicker">装备详情</div>
        <div className="equipment-detail-meta">
          <span>{EQUIPMENT_CATEGORY_NAMES[definition.category]}</span>
          <span className={`rarity-${definition.rarity.toLowerCase()}`}>
            {definition.rarity}
          </span>
        </div>
        <h2 id="equipment-detail-title">{definition.name}</h2>
        <div className="equipment-detail-effect">
          <span>装备效果</span>
          <p>{definition.description}</p>
        </div>
        <button className="primary-button secondary" onClick={onClose}>关闭</button>
      </motion.section>
    </ModalBackdrop>
  );
}
