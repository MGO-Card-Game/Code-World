import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
  type EquipmentCategory,
} from "../game/content/equipment";
import { SCROLLS } from "../game/content/scrolls";
import { getAttack, getDefense } from "../game/selectors";
import type { PlayerView } from "../game/types";
import { visibleScrolls } from "./shared";

const EQUIPMENT_CATEGORIES = [
  "weapon",
  "armor",
  "shoes",
  "accessory",
] as const satisfies readonly EquipmentCategory[];

export function ShopInventorySummary({ player, revealScrolls }: {
  player: PlayerView;
  revealScrolls: boolean;
}) {
  const scrolls = revealScrolls ? visibleScrolls(player.scrolls) : [];

  return (
    <section className="shop-inventory" aria-label={`${player.name}当前持有`}>
      <div className="shop-inventory-heading">
        <div>
          <span>当前持有</span>
          <strong>{player.name}</strong>
        </div>
        <dl>
          <div><dt>金币</dt><dd>{player.gold}</dd></div>
          <div><dt>生命</dt><dd>{player.hp}/{player.maxHp}</dd></div>
          <div><dt>攻击</dt><dd>{getAttack(player)}</dd></div>
          <div><dt>防御</dt><dd>{getDefense(player)}</dd></div>
        </dl>
      </div>

      <div className="shop-inventory-resources">
        <div className="shop-inventory-scrolls">
          <b>卷轴 <em>{player.scrolls.length}</em></b>
          <div>
            {player.scrolls.length === 0 && <span className="empty">暂无卷轴</span>}
            {!revealScrolls && player.scrolls.length > 0 && (
              <span className="hidden-resource">牌面仅持有者可见</span>
            )}
            {scrolls.map((scroll) => (
              <span className="resource-chip" key={scroll.instanceId}>
                {SCROLLS[scroll.kind].name}
              </span>
            ))}
          </div>
        </div>

        <div className="shop-inventory-equipment">
          {EQUIPMENT_CATEGORIES.map((category) => {
            const items = player.equipment.filter(
              (item) => equipmentCategory(item.kind) === category,
            );
            const emptySlots = EQUIPMENT_SLOT_LIMITS[category] - items.length;
            return (
              <div key={category}>
                <b>{EQUIPMENT_CATEGORY_NAMES[category]}</b>
                <span>
                  {items.map((item) => EQUIPMENT[item.kind].name).join("、") || "空"}
                  {emptySlots > 0 && items.length > 0 ? ` · 空位 ${emptySlots}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
