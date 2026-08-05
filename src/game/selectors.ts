import { EQUIPMENT, SCROLLS } from "./content";
import type { EquipmentKind, Player, ScrollTiming } from "./types";

function equipmentCount(player: Player, kind: EquipmentKind) {
  return player.equipment.filter((item) => item.kind === kind).length;
}

export function getAttack(player: Player) {
  return player.baseAttack + equipmentCount(player, "sword");
}

export function getDefense(player: Player) {
  return player.baseDefense + equipmentCount(player, "shield");
}

export function describeEquipment(player: Player) {
  return player.equipment.map((item) => EQUIPMENT[item.kind].name);
}

/**
 * 该玩家此刻能打出的卷轴（GameRule 8.3 / 8.9）。
 *
 * 按 timing 过滤而不是按 kind——加新卷轴时这里不用改。
 */
export function playableScrolls(player: Player, timing: ScrollTiming) {
  return player.scrolls.filter((scroll) => SCROLLS[scroll.kind].timing === timing);
}
