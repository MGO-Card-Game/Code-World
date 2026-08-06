import type {
  BattleHookContext,
  RollModifiers,
  RollResult,
  StatModifier,
} from "./battleHooks";
import type {
  BattleState,
  CombatSide,
  GameState,
  OwnedEquipment,
  OwnedScroll,
  Player,
  PlayerStats,
} from "../types";

/**
 * 卷轴与装备专属的效果词汇。与怪物共用的那一层在 ./battleHooks。
 */

/** 生命上限需要装备/卸下时同步真实生命值，不能作为动态查询修正返回。 */
export type DynamicEquipmentModifier = Exclude<StatModifier, { type: "maxHp" }>;

/**
 * 可以直接由配置表达的一次性卷轴效果。
 *
 * custom 直接挂函数而不是挂解析器名字：卡牌定义只活在模块常量里，
 * GameState 只保存 { instanceId, kind }，所以这里放代码不影响序列化与联机同步。
 */
export type ScrollEffectDefinition =
  | { type: "flatBonus"; value: number }
  | { type: "dieSides"; sides: number }
  | { type: "extraDice"; count: number }
  | { type: "minimumRoll"; value: number }
  /** 把本次投骰中的前 count 颗直接视为最高面，不影响其余骰子 */
  | { type: "maxRoll"; count: number }
  | { type: "directDamage"; amount: number }
  | { type: "heal"; amount: number }
  /** 地图阶段放弃本次移动；战斗中使用则失去下一次地图移动。 */
  | { type: "forfeitMovement" }
  | { type: "custom"; resolve: ScrollEffectResolver };

/** 声明式效果覆盖不了的卷轴，直接在卡牌定义里写这个函数。 */
export interface ScrollEffectContext {
  state: GameState;
  battle: BattleState;
  sourceSide: CombatSide;
  targetSide: CombatSide;
  modifiers: RollModifiers;
  dealDamage: (rawDamage: number) => boolean;
  addBattleLog: (text: string) => void;
}

export type ScrollEffectResolver = (
  context: ScrollEffectContext,
) => { targetDefeated?: boolean } | void;

export interface EquipmentLifecycleContext {
  state: GameState;
  player: Player;
  item: OwnedEquipment;
}

/**
 * 装备参与战斗结算时能看到的东西，对标卷轴的 ScrollEffectContext。
 *
 * 在公共层之上补的两个字段就是装备与怪物的全部差别：装备是玩家身上的一个实例，
 * 因此既要知道持有者是谁，也要知道自己是哪一件。
 */
export type EquipmentBattleContext = BattleHookContext & {
  player: Player;
  item: OwnedEquipment;
};

/**
 * 战斗开始时装备能做的事。
 *
 * grantBattleScroll 发的是**临时牌**：战斗结束时统一回收，不进常驻手牌，
 * 也不会出现在随机卡池里。用它可以把「每场战斗一次的主动技」表达成一张
 * 战斗内限定的卷轴——发动时机、暗牌、联机归属全部复用已有的选牌阶段，
 * 不必为装备另开一套交互。
 */
export interface EquipmentBattleStartContext {
  state: GameState;
  battle: BattleState;
  side: CombatSide;
  player: Player;
  item: OwnedEquipment;
  grantBattleScroll: (kind: OwnedScroll["kind"]) => void;
}

/**
 * 通用 modifier 表达不了的装备逻辑，直接写在卡牌定义的 effects 上。
 * 和卷轴的 custom 同理：定义不进 GameState，放函数是安全的。
 */
export interface EquipmentEffects {
  /** 战斗开始、投先攻骰之后。 */
  onBattleStart?: (context: EquipmentBattleStartContext) => void;
  /** 条件装备可根据玩家当前状态动态返回额外修正。 */
  modifiers?: (context: {
    player: PlayerStats;
    item: OwnedEquipment;
  }) => readonly DynamicEquipmentModifier[];
  /**
   * 掷骰前。可以改本次投骰参数，也是唯一能读到对手状态的时机。
   * 卷轴先结算，装备后结算——卷轴的 sidesOverride 是"替换基础骰面"，
   * 装备的 dieSides 修正在 rollForSide 里叠加在替换结果之上。
   */
  beforeRoll?: (context: EquipmentBattleContext) => void;
  /**
   * 掷骰后、算总和之前。能读到骰面结果，通常用来追加伤害或再加值。
   * 此时改 flatBonus 仍会计入本次合计。
   */
  afterRoll?: (context: EquipmentBattleContext & { roll: RollResult }) => void;
  onEquip?: (context: EquipmentLifecycleContext) => void;
  onUnequip?: (context: EquipmentLifecycleContext) => void;
}
