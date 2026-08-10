import type { EnemyEffects, StatModifier } from "../../effects/battleHooks";
import type { MapRegionId } from "../../types";

/**
 * 怪物本体的档位。词条是贴在漫游怪身上的正交标志，不在这里，见 ./affixes。
 *
 * roaming：进战斗格随机池，按区域权重抽取。
 * elite：进精英格随机池，不携带词条。
 * boss：只在阶段首领战出现，不携带词条。
 */
export type EnemyTier = "roaming" | "elite" | "boss";

export const ENEMY_TIER_NAMES: Record<EnemyTier, string> = {
  roaming: "漫游",
  elite: "精英",
  boss: "首领",
};

/** 玩家可以在地图首领情报与战斗界面中查看的能力说明。 */
export interface EnemyAbility {
  name: string;
  description: string;
}

/**
 * 先攻投骰的特征化限制，不写就和玩家一样自由投 1-6。
 *
 * fixed 钉死一个点数——笨重、呆板的怪不该吃到"先攻骰爆 6"这种和它形象不符的运气；
 * range 只收窄骰池的上下界，敏捷或迟缓的怪据此偏移概率分布，而不是彻底抹平随机性。
 */
export type EnemyInitiative =
  | { type: "fixed"; value: number }
  | { type: "range"; min: number; max: number };

/** 一只怪的内容。这里没有 tier——它由所在的档位表盖章，见 defineEnemies。 */
export interface EnemyBody {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 与 modifiers/effects 对应的玩家可见说明；规则逻辑仍由后两者执行。 */
  abilities?: readonly EnemyAbility[];
  /**
   * 出现在哪些区域，值是该区域内的相对权重。
   *
   * 写在怪身上而不是让地图持有名单：卡池由内容推导，和「稀有度写在卡上、
   * 抽取由 index 负责」是同一个形状。boss 档不写——它由地图固定格投放。
   */
  regions?: Partial<Record<MapRegionId, number>>;
  /**
   * 攻防血之外的永久修正，和装备卡的 modifiers 同一份类型。
   *
   * 骰面和骰数没有对应的基础字段，只能走这里；写成 modifier 而不是钩子，
   * 是因为无条件的数值改动不该占用钩子——钩子是给「看情况」的效果用的。
   */
  modifiers?: readonly StatModifier[];
  /** 通用数值表达不了的逻辑直接写在这里，和装备的 effects 同理。 */
  effects?: EnemyEffects;
  /** 先攻骰的特征化限制，见 EnemyInitiative。 */
  initiative?: EnemyInitiative;
}

export type EnemyDefinition = EnemyBody & { tier: EnemyTier };

/**
 * 给一整张档位表盖上 tier。
 *
 * 档位写在文件层面而不是每只怪上：怪各自声明 tier 时，它可以和所在文件对不上；
 * 盖章之后这种漂移在结构上就不存在了。和 defineEquipment 同形。
 */
export function defineEnemies<
  T extends EnemyTier,
  R extends Record<string, EnemyBody>,
>(tier: T, table: R): { [K in keyof R]: R[K] & { tier: T } } {
  return Object.fromEntries(
    Object.entries(table).map(([kind, body]) => [kind, { ...body, tier }]),
  ) as { [K in keyof R]: R[K] & { tier: T } };
}
