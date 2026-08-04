import { EQUIPMENT } from "./content";
import type { EquipmentKind, Player } from "./types";

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
