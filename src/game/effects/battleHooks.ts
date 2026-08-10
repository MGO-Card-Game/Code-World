import type { BattleState, CombatSide, GameState } from "../types";

/**
 * 战斗结算里与「谁持有这个效果」无关的那一层。
 *
 * 装备、卷轴和怪物三方共用这些词汇：装备挂在玩家实例上，怪物只活在定义表里，
 * 但它们改的是同一次投骰。把公共部分单独放一个文件，两边加字段时只改一处，
 * 也避免了怪物去 import 一个名字里写着 Equipment 的类型。
 */

export type DiceKind = "attack" | "defense" | "movement";

/**
 * 可以直接由配置表达的永久数值修正。
 *
 * 装备和精英词缀共用同一份：一件「攻击 +1」的装备和一条「攻击 +1」的词缀，
 * 折算方式没有任何区别，没理由写成两个类型。
 */
export type StatModifier =
  | { type: "statBonus"; stat: "attack" | "defense"; value: number }
  | { type: "dieSides"; die: DiceKind; value: number }
  | { type: "diceCount"; die: Exclude<DiceKind, "movement">; value: number }
  | { type: "maxHp"; value: number };

/**
 * 本次攻防投骰的临时修正。卷轴、装备与怪物共用一份，自定义效果都可以改。
 */
export interface RollModifiers {
  flatBonus: number;
  sidesOverride?: number;
  extraDice: number;
  /** 每颗骰子投几次；多张同类牌取最大次数，不按张数累加。 */
  rollAttempts: number;
  /** 重复投骰后取高或取低；取低属于装备代价，优先于卷轴的取高。 */
  rollSelection: "highest" | "lowest";
  /** 自然投骰只会出现 1 或当前骰面上限；固定点数类效果仍可覆盖。 */
  extremeFaces: boolean;
  minimumRoll: number;
  /**
   * 本次投骰中有几颗直接视为最高面。
   *
   * 和 minimumRoll 的区别：minimumRoll 抬高**每一颗**骰子的下限，
   * 配上满载骰池会把三颗一起拉满；这个只作用于指定数量的骰子。
   */
  maxRollDice: number;
  /**
   * 本次投骰中有几颗直接定为 fixedRollValue，以及定成几点。
   *
   * 和 maxRollDice 是一对：那个把骰子拉到上限，只赚不亏；这个把骰子**钉死**在一个
   * 具体点数上，可能比随机结果更差。所以它不是 minimumRoll 的变体——引擎里所有决策
   * 都在投骰之前，钉死一个中间值是真取舍，用 5、6、7 的可能性换掉 1、2、3。
   *
   * 落在哪几颗上见 rollForSide：先给 maxRollDice，再给这个，两者不抢同一颗。
   */
  fixedRollDice: number;
  fixedRollValue: number;
  /**
   * 攻防差算完之后再追加的伤害，不被防御吸收。
   *
   * 只有攻击方的这一份会被结算，别在防守侧写它。防守方的反伤（荆棘铠甲那类）
   * 现在只差一半：扣血入口 dealBattleDamage 已经能对任意一侧发伤害，但"反伤打死
   * 攻击者、同一回合防守方自己也倒下"该判谁赢还没有规则，得先定了再做。
   */
  bonusDamage: number;
  /** 最终伤害的保底值，在防御与减伤结算后应用。 */
  minimumDamage: number;
  /** 攻防差与追加伤害合计后再减免；只读取防守方这一份。 */
  damageReduction: number;
}

/** 传给掷骰后钩子的那一次投骰结果。 */
export interface RollResult {
  sides: number;
  dice: readonly number[];
  sum: number;
}

/**
 * 一次投骰里，与持有者无关的那部分上下文。
 *
 * 血量刻意由上下文给出，而不是让效果自己读 player.hp：PvP 的战斗生命值存在
 * battle.hpA / hpB 上，战斗期间 player.hp 根本不动，直接读会拿到开战前的数值。
 */
export interface BattleEffectContext {
  state: GameState;
  battle: BattleState;
  /** 效果持有者所在的一侧 */
  side: CombatSide;
  opponentSide: CombatSide;
  ownHp: number;
  ownMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  /**
   * 本场战斗中双方各自已经打出的卷轴张数。
   *
   * 和血量同理由上下文给出：张数记在 BattleState 上（见 scrollsUsedA），
   * 效果自己去数手牌是数不出来的——牌打完就离手了。
   */
  ownScrollsUsed: number;
  opponentScrollsUsed: number;
  addBattleLog: (text: string) => void;
}

export interface BattleHookContext extends BattleEffectContext {
  /** 本次投的是攻击骰还是防御骰 */
  dieKind: Exclude<DiceKind, "movement">;
  modifiers: RollModifiers;
}

export interface EnemyBeforeRollContext extends BattleHookContext {
  /** 对对手造成会被其防御值减免的能力伤害；返回对手是否被击倒。 */
  dealDamage: (rawDamage: number, abilityName: string) => boolean;
}

/** 一次敌方攻击及其伤害已经完整结算，且防守方仍然存活。 */
export interface EnemyAfterAttackContext extends BattleEffectContext {
  attacksPerformed: number;
  /** 本次普通攻击最终实际扣除的生命。 */
  damageDealt: number;
  /** 能力造成的生命损失不经过受击减伤；返回怪物是否因此倒下。 */
  loseHp: (amount: number, logLine: string) => boolean;
  /** 让玩家的下一次攻击承受一次性减值。 */
  penalizeNextPlayerAttack: (by: number, logLine: string) => void;
}

/**
 * 即将落到这只怪头上的一次伤害，与装备的 EquipmentDamageContext 同一时机。
 *
 * 存在的理由和那边一样：防守方的 afterRoll 读不到对手的合计，"受到的伤害至多为 N"
 * 这类效果只能站在结果上看。改伤同样只能变小，顺序无关性靠它成立。
 */
export interface EnemyDamageContext {
  state: GameState;
  battle: BattleState;
  /** 受击的一侧，也就是这只怪所在的一侧 */
  side: CombatSide;
  sourceSide: CombatSide;
  /** 扣血前的战斗生命值 */
  ownHp: number;
  ownMaxHp: number;
  /** 任何钩子动手之前的伤害，是快照而不是实时值，理由同装备那份 */
  incoming: number;
  /** 减免固定伤害量。 */
  reduceDamage: (by: number) => void;
  /** 把这一次伤害压到不超过 max。 */
  capDamage: (max: number) => void;
  addBattleLog: (text: string) => void;
}

/**
 * 怪物本体与精英词缀的战斗钩子。
 *
 * 上下文就是公共层本身，没有额外字段：怪物不是实例，不会被穿上或卸下，
 * 也不持有手牌——写在哪只怪身上，钩子就知道自己是谁。
 *
 * 刻意不提供 onBattleStart。装备那个钩子存在的理由是 grantBattleScroll，
 * 而 GameRule 8.6 明确怪物不使用卷轴；真有需求时再加，届时是一处改动。
 */
export interface EnemyEffects {
  /** 掷骰前。可以改本次投骰参数，也是唯一能读到对手状态的时机。 */
  beforeRoll?: (context: EnemyBeforeRollContext) => void;
  /** 掷骰后、算总和之前。此时改 flatBonus 仍会计入本次合计。 */
  afterRoll?: (context: BattleHookContext & { roll: RollResult }) => void;
  /**
   * 伤害落地前，只对受击方调用。
   *
   * 挂在 dealBattleDamage 这个唯一漏斗上，所以攻防结算和卷轴直伤都会经过——
   * 减伤类怪物才不会出现"攻防差压得住、直伤照样穿"的缺口。
   */
  beforeDamage?: (context: EnemyDamageContext) => void;
  /** 攻击伤害与防守方倒地判定之后。防守方已倒下时不会调用。 */
  afterAttack?: (context: EnemyAfterAttackContext) => void;
}
