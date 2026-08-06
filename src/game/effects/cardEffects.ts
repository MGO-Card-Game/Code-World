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
  | { type: "directDamage"; amount: number }
  | { type: "custom"; resolve: ScrollEffectResolver };

/**
 * 本次攻防投骰的临时修正。卷轴与装备共用一份，自定义效果都可以改。
 */
export interface RollModifiers {
  flatBonus: number;
  sidesOverride?: number;
  extraDice: number;
  minimumRoll: number;
  /**
   * 攻防差算完之后再追加的伤害，不被防御吸收。
   *
   * 只有攻击方的这一份会被结算。防守方的反伤（荆棘铠甲那类）要有自己的
   * battleDamage 事件和击倒判定顺序，目前还没做，所以别在防守侧写它。
   */
  bonusDamage: number;
}

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

/** 传给装备战斗钩子的那一次投骰结果。 */
export interface EquipmentRollResult {
  sides: number;
  dice: readonly number[];
  sum: number;
}

/**
 * 装备参与战斗结算时能看到的东西，对标卷轴的 ScrollEffectContext。
 *
 * 血量刻意由上下文给出，而不是让效果自己读 player.hp：PvP 的战斗生命值存在
 * battle.hpA / hpB 上，战斗期间 player.hp 根本不动，直接读会拿到开战前的数值。
 */
export interface EquipmentBattleContext {
  state: GameState;
  battle: BattleState;
  /** 装备持有者所在的一侧 */
  side: CombatSide;
  opponentSide: CombatSide;
  /** 本次投的是攻击骰还是防御骰 */
  dieKind: Exclude<DiceKind, "movement">;
  player: Player;
  item: OwnedEquipment;
  /** 与卷轴共用的本次投骰修正 */
  modifiers: RollModifiers;
  ownHp: number;
  ownMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  addBattleLog: (text: string) => void;
}

/**
 * 通用 modifier 表达不了的装备逻辑，直接写在卡牌定义的 effects 上。
 * 和卷轴的 custom 同理：定义不进 GameState，放函数是安全的。
 */
export interface EquipmentEffects {
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
  afterRoll?: (
    context: EquipmentBattleContext & { roll: EquipmentRollResult },
  ) => void;
  onEquip?: (context: EquipmentLifecycleContext) => void;
  onUnequip?: (context: EquipmentLifecycleContext) => void;
}
