import {
  ELITE_BASE_MODIFIERS,
  eliteAffixDefinition,
  enemyDefinition,
} from "./content/enemies";
import { EQUIPMENT, equipmentDefinition } from "./content/equipment";
import { blessingDefinition } from "./content/blessings";
import { scrollDefinition, type ScrollKind } from "./content/scrolls";
import type {
  BattleDiceKind,
  CountedDiceKind,
  DiceKind,
  EnemyEffects,
  StatModifier,
} from "./effects/battleHooks";
import type {
  BattleState,
  EliteAffixKind,
  EnemyKind,
  Player,
  PlayerStats,
  ScrollTiming,
} from "./types";

/**
 * 把一组修正折算成一个数。
 *
 * 玩家的五个查询和怪物那几个是同一个 filter + reduce 形状，抄五遍不如收在一处：
 * 加一种 StatModifier 时只有这里需要知道怎么求和。
 */
function foldModifiers(
  modifiers: readonly StatModifier[],
  matches: (modifier: StatModifier) => boolean,
) {
  return modifiers
    .filter(matches)
    .reduce((sum, modifier) => sum + modifier.value, 0);
}

function statBonus(modifiers: readonly StatModifier[], stat: "attack" | "defense") {
  return foldModifiers(
    modifiers,
    (modifier) => modifier.type === "statBonus" && modifier.stat === stat,
  );
}

function dieSidesBonus(modifiers: readonly StatModifier[], die: DiceKind) {
  return foldModifiers(
    modifiers,
    (modifier) => modifier.type === "dieSides" && modifier.die === die,
  );
}

function diceCountBonus(
  modifiers: readonly StatModifier[],
  die: CountedDiceKind,
) {
  return foldModifiers(
    modifiers,
    (modifier) => modifier.type === "diceCount" && modifier.die === die,
  );
}

function maxHpBonus(modifiers: readonly StatModifier[]) {
  return foldModifiers(modifiers, (modifier) => modifier.type === "maxHp");
}

export function equipmentModifiers(player: PlayerStats): StatModifier[] {
  return player.equipment.flatMap((item) => {
    const definition = equipmentDefinition(item.kind);
    return [
      ...definition.modifiers,
      ...(definition.effects?.modifiers?.({ player, item }) ?? []),
    ];
  });
}

export function blessingModifiers(player: PlayerStats): StatModifier[] {
  return player.blessings.flatMap((blessing) =>
    blessingDefinition(blessing.kind).modifiers
  );
}

export function playerModifiers(player: PlayerStats): StatModifier[] {
  return [...equipmentModifiers(player), ...blessingModifiers(player)];
}

export function getAttack(player: PlayerStats) {
  return player.baseAttack + statBonus(playerModifiers(player), "attack");
}

export function getDefense(player: PlayerStats) {
  return player.baseDefense + statBonus(playerModifiers(player), "defense");
}

export function getDieSidesBonus(player: PlayerStats, die: DiceKind) {
  return dieSidesBonus(playerModifiers(player), die);
}

export function getDiceCountBonus(
  player: PlayerStats,
  die: CountedDiceKind,
) {
  return diceCountBonus(playerModifiers(player), die);
}

export function getMaxHpBonus(player: PlayerStats) {
  return maxHpBonus(playerModifiers(player));
}

/**
 * 一只怪身上的全部修正：本体的，加上精英词缀的（含所有精英共享的基础强化）。
 *
 * 顺序是本体先、词缀后。累加类修正与顺序无关，这里只是让读起来和结算一致。
 */
export function enemyModifiers(
  kind: EnemyKind,
  affix?: EliteAffixKind,
): StatModifier[] {
  const base = [...(enemyDefinition(kind).modifiers ?? [])];
  if (!affix) return base;
  return [...base, ...ELITE_BASE_MODIFIERS, ...eliteAffixDefinition(affix).modifiers];
}

/**
 * 折算后的怪物属性。名字带上词缀前缀，血量含词缀加成。
 *
 * 战斗里凡是要「这只怪多少攻/防/血、叫什么」的地方都走这里，
 * 免得某一处忘了折算词缀，精英怪在那一处退化成普通怪。
 */
export function enemyStats(kind: EnemyKind, affix?: EliteAffixKind) {
  const definition = enemyDefinition(kind);
  const modifiers = enemyModifiers(kind, affix);
  return {
    name: affix ? `${eliteAffixDefinition(affix).name}${definition.name}` : definition.name,
    maxHp: definition.maxHp + maxHpBonus(modifiers),
    attack: definition.attack + statBonus(modifiers, "attack"),
    defense: definition.defense + statBonus(modifiers, "defense"),
  };
}

export function enemyDieSidesBonus(
  kind: EnemyKind,
  affix: EliteAffixKind | undefined,
  die: DiceKind,
) {
  return dieSidesBonus(enemyModifiers(kind, affix), die);
}

export function enemyDiceCountBonus(
  kind: EnemyKind,
  affix: EliteAffixKind | undefined,
  die: BattleDiceKind,
) {
  return diceCountBonus(enemyModifiers(kind, affix), die);
}

/** 本体先、词缀后，与 enemyModifiers 同序。 */
export function enemyEffects(
  kind: EnemyKind,
  affix?: EliteAffixKind,
): readonly EnemyEffects[] {
  const effects: EnemyEffects[] = [];
  const base = enemyDefinition(kind).effects;
  if (base) effects.push(base);
  const affixEffects = affix ? eliteAffixDefinition(affix).effects : undefined;
  if (affixEffects) effects.push(affixEffects);
  return effects;
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
 * 卡牌自带的使用对象限制（GameRule 8.3）。没配 usableAgainst 的牌永远通过。
 *
 * 战斗外（地图时机）没有对手可判，调用方不传 battle 就跳过这一层。
 */
export function scrollUsableAgainst(
  kind: ScrollKind,
  battle: Pick<BattleState, "kind" | "enemyId" | "enemyAffix"> | undefined,
) {
  if (!battle) return true;
  return scrollDefinition(kind).usableAgainst?.(battle) ?? true;
}

/**
 * 该玩家此刻能打出的卷轴（GameRule 8.3 / 8.9）。
 *
 * 按 timing 过滤而不是按 kind——加新卷轴时这里不用改。
 * 战斗里再传 battle，把挑对手的牌（斩首命令）从可选列表里摘掉。
 */
export function playableScrolls(
  player: Player,
  timing: ScrollTiming,
  battle?: Pick<BattleState, "kind" | "enemyId" | "enemyAffix">,
) {
  const blocked = player.equipment.some((item) =>
    equipmentDefinition(item.kind).effects?.blockedScrollTimings?.includes(timing)
  );
  if (blocked) return [];
  return player.scrolls.filter((scroll) =>
    scrollDefinition(scroll.kind).timings.includes(timing)
    && scrollUsableAgainst(scroll.kind, battle)
  );
}

export function equipmentBlocksScrollTiming(
  player: Pick<PlayerStats, "equipment">,
  timing: ScrollTiming,
) {
  return player.equipment.some((item) =>
    equipmentDefinition(item.kind).effects?.blockedScrollTimings?.includes(timing)
  );
}
