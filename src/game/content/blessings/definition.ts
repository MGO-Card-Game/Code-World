import type { StatModifier } from "../../effects/battleHooks";

export type BlessingEffectDefinition =
  | { type: "minimumCombatRoll"; value: number }
  | { type: "movementRollBonus"; value: number }
  | { type: "extraPveVictoryScroll"; count: number }
  | { type: "extraTreasureEquipment"; count: number }
  | { type: "replacePvpPenaltyWithHpLoss"; amount: number }
  /** 经济系统的预留效果；金币上线前对应赐福不会进入随机池。 */
  | { type: "goldGainMultiplier"; multiplier: number };

/**
 * 一种可随机获得、可在 PvP 胜负后转移的永久赐福。
 *
 * 当前先开放通用数值修正。遇到无法由 modifier 表达的具体 Buff 时，
 * 再按实际需求增加生命周期钩子，避免在内容确定前猜测接口。
 */
export interface BlessingDefinition {
  name: string;
  description: string;
  /** 同一赐福池中的相对抽取权重，必须是正数。 */
  weight: number;
  /** false 表示内容已登记，但暂不进入随机池。 */
  enabled?: boolean;
  modifiers: readonly StatModifier[];
  effects?: readonly BlessingEffectDefinition[];
}

export function defineBlessings<T extends Record<string, BlessingDefinition>>(table: T): T {
  return table;
}
