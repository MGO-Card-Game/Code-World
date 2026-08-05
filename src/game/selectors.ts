import { EQUIPMENT, equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import { CUSTOM_EQUIPMENT_EFFECTS } from "./effects/customEquipmentEffects";
import type { DiceKind, EquipmentModifier } from "./effects/cardEffects";
import type { Player, PlayerStats, ScrollTiming } from "./types";

export function equipmentModifiers(player: PlayerStats): EquipmentModifier[] {
  return player.equipment.flatMap((item) => {
    const definition = equipmentDefinition(item.kind);
    const custom = definition.customResolver
      ? CUSTOM_EQUIPMENT_EFFECTS[definition.customResolver]
      : undefined;
    if (definition.customResolver && !custom) {
      throw new Error(`装备效果解析器未注册：${definition.customResolver}`);
    }
    return [
      ...definition.modifiers,
      ...(custom?.modifiers?.({ player, item }) ?? []),
    ];
  });
}

export function getAttack(player: PlayerStats) {
  return player.baseAttack + equipmentModifiers(player)
    .filter((effect) => effect.type === "statBonus" && effect.stat === "attack")
    .reduce((sum, effect) => sum + effect.value, 0);
}

export function getDefense(player: PlayerStats) {
  return player.baseDefense + equipmentModifiers(player)
    .filter((effect) => effect.type === "statBonus" && effect.stat === "defense")
    .reduce((sum, effect) => sum + effect.value, 0);
}

export function getDieSidesBonus(player: PlayerStats, die: DiceKind) {
  return equipmentModifiers(player)
    .filter((effect) => effect.type === "dieSides" && effect.die === die)
    .reduce((sum, effect) => sum + effect.value, 0);
}

export function getDiceCountBonus(
  player: PlayerStats,
  die: Exclude<DiceKind, "movement">,
) {
  return equipmentModifiers(player)
    .filter((effect) => effect.type === "diceCount" && effect.die === die)
    .reduce((sum, effect) => sum + effect.value, 0);
}

export function getMaxHpBonus(player: PlayerStats) {
  return equipmentModifiers(player)
    .filter((effect) => effect.type === "maxHp")
    .reduce((sum, effect) => sum + effect.value, 0);
}

export function describeEquipment(player: PlayerStats) {
  return player.equipment.map((item) => EQUIPMENT[item.kind].name);
}

/**
 * 该玩家此刻能打出的卷轴（GameRule 8.3 / 8.9）。
 *
 * 按 timing 过滤而不是按 kind——加新卷轴时这里不用改。
 */
export function playableScrolls(player: Player, timing: ScrollTiming) {
  return player.scrolls.filter((scroll) =>
    scrollDefinition(scroll.kind).timings.includes(timing)
  );
}
