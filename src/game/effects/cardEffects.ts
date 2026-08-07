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
 * 即将落到自己头上的一次伤害。
 *
 * 这是唯一能读到"这一下要掉多少血"的时机：攻防差、追加伤害和卷轴直伤都已经折算完，
 * 血还没扣。防守方的 afterRoll 读不到对手的合计，所以护甲的减免、致命拦截这类效果
 * 只能挂在这里——判据是它们关心的是结果，不是自己那次投骰。
 *
 * 改伤害只能通过 reduceDamage / keepAtLeast，两者都只会让伤害变小。这不是洁癖：
 * 顺序无关是靠它成立的（多件装备一起挂钩子时谁先谁后不影响结果），而且减伤时机
 * 不该能加伤——真要加伤，加在攻击方的 bonusDamage 上，那里是公开算进合计的。
 * 用函数而不是可写字段，还顺带挡掉了 `beforeDamage({ ...ctx })` 之后改副本这个坑。
 */
export interface EquipmentDamageContext {
  state: GameState;
  battle: BattleState;
  /** 受击的一侧，也就是这件装备主人所在的一侧 */
  side: CombatSide;
  sourceSide: CombatSide;
  player: Player;
  item: OwnedEquipment;
  /** 扣血前的战斗生命值。PvP 期间 player.hp 不动，一律读这个 */
  ownHp: number;
  ownMaxHp: number;
  /**
   * 任何钩子动手之前的伤害，用来判断"这一下有没有真的打到"。
   *
   * 刻意是快照而不是实时值：护甲关心的是这一击本身，而不是别的装备减免完剩多少。
   */
  incoming: number;
  /** 减免固定伤害量。 */
  reduceDamage: (by: number) => void;
  /** 把伤害压到"扣完至少还剩 hp 点"，用于致命拦截。 */
  keepAtLeast: (hp: number) => void;
  addBattleLog: (text: string) => void;
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
  /**
   * 伤害落地前，只对受击方调用。
   *
   * 与 afterRoll 的分工：afterRoll 站在自己那次投骰上，看不到对手的合计；
   * 这里站在结果上，看得到最终伤害和自己的剩余血量，但只能把伤害改小。
   */
  beforeDamage?: (context: EquipmentDamageContext) => void;
  onEquip?: (context: EquipmentLifecycleContext) => void;
  onUnequip?: (context: EquipmentLifecycleContext) => void;
}
