import type {
  BattleState,
  CombatSide,
  GameState,
  OwnedEquipment,
  Player,
  PlayerStats,
} from "../types";

export type DiceKind = "attack" | "defense" | "movement";

/** 可以直接由配置表达的永久装备修正。 */
export type EquipmentModifier =
  | { type: "statBonus"; stat: "attack" | "defense"; value: number }
  | { type: "dieSides"; die: DiceKind; value: number }
  | { type: "diceCount"; die: Exclude<DiceKind, "movement">; value: number }
  | { type: "maxHp"; value: number };

/** 生命上限需要装备/卸下时同步真实生命值，不能作为动态查询修正返回。 */
export type DynamicEquipmentModifier = Exclude<
  EquipmentModifier,
  { type: "maxHp" }
>;

/** 可以直接由配置表达的一次性卷轴效果。 */
export type ScrollEffectDefinition =
  | { type: "flatBonus"; value: number }
  | { type: "dieSides"; sides: number }
  | { type: "extraDice"; count: number }
  | { type: "minimumRoll"; value: number }
  | { type: "directDamage"; amount: number }
  | {
      type: "custom";
      resolver: string;
      parameters?: Readonly<Record<string, string | number | boolean>>;
    };

/** 本次攻防投骰前累积的临时修正，自定义效果也可以修改它。 */
export interface ScrollRollModifiers {
  flatBonus: number;
  sidesOverride?: number;
  extraDice: number;
  minimumRoll: number;
}

/**
 * 声明式效果无法覆盖特殊卡时使用的逃生舱。
 * resolver 是代码，不进入 GameState；状态里仍然只保存卡牌 kind，因此可序列化。
 */
export interface CustomScrollEffectContext {
  state: GameState;
  battle: BattleState;
  sourceSide: CombatSide;
  targetSide: CombatSide;
  modifiers: ScrollRollModifiers;
  parameters: Readonly<Record<string, string | number | boolean>>;
  dealDamage: (rawDamage: number) => boolean;
  addBattleLog: (text: string) => void;
}

export type CustomScrollEffectResolver = (
  context: CustomScrollEffectContext,
) => { targetDefeated?: boolean } | void;

export interface CustomEquipmentEffectContext {
  state: GameState;
  player: Player;
  item: OwnedEquipment;
}

export interface CustomEquipmentEffectResolver {
  /** 条件装备可根据玩家当前状态动态返回额外修正。 */
  modifiers?: (context: {
    player: PlayerStats;
    item: OwnedEquipment;
  }) => readonly DynamicEquipmentModifier[];
  onEquip?: (context: CustomEquipmentEffectContext) => void;
  onUnequip?: (context: CustomEquipmentEffectContext) => void;
}
