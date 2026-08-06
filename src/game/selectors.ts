import { EQUIPMENT, equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import type { DiceKind, EquipmentModifier } from "./effects/cardEffects";
import type { Player, PlayerStats, ScrollTiming } from "./types";

export function equipmentModifiers(player: PlayerStats): EquipmentModifier[] {
  return player.equipment.flatMap((item) => {
    const definition = equipmentDefinition(item.kind);
    return [
      ...definition.modifiers,
      ...(definition.effects?.modifiers?.({ player, item }) ?? []),
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

/**
 * 相遇战「转移生命」这项代价此刻能转多少（GameRule 7.9）。
 *
 * 三处要用同一个数：finishPvp 判断要不要进代价阶段、choosePvpPenalty 执行转移、
 * 界面决定要不要画那个按钮。各写一份就会错开——界面给出的选项引擎不接受，
 * 玩家点了没反应，而且是静默的，连报错都没有。
 *
 * 返回 0 表示这项代价付不出来：赢家已经满血，或者败方只剩 1 点生命
 * （代价不能把人打死，所以留 1 点底）。
 */
export function pvpHpTransferAmount(
  winner: Pick<PlayerStats, "hp" | "maxHp">,
  loser: Pick<PlayerStats, "hp">,
) {
  return Math.max(0, Math.min(3, winner.maxHp - winner.hp, loser.hp - 1));
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
