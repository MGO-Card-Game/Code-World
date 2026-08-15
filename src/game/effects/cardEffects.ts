import type {
  BattleEffectContext,
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
  ScrollTiming,
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
  | { type: "dieSidesBonus"; value: number }
  | { type: "extraDice"; count: number }
  | { type: "rollTwice" }
  | { type: "minimumRoll"; value: number }
  /** 把本次投骰中的前 count 颗直接视为最高面，不影响其余骰子 */
  | { type: "maxRoll"; count: number }
  /** 把本次投骰中的 count 颗直接定为 value，不影响其余骰子 */
  | { type: "fixedRoll"; count: number; value: number }
  | { type: "directDamage"; amount: number }
  | { type: "damageReduction"; amount: number }
  | { type: "damageCap"; amount: number }
  /** 立刻损失生命，不经过护甲的受伤钩子。 */
  | { type: "selfHpLoss"; amount: number }
  /** 本轮攻防与伤害完整结算后再损失生命；战斗已经结束则不再追收。 */
  | { type: "postRoundSelfHpLoss"; amount: number }
  /** 双方同时承受一次减当前防御的直接伤害；同归时出牌者判负。 */
  | { type: "mutualDirectDamage"; amount: number }
  /** 让自己下一次轮到主动攻击时直接跳过该攻击轮。 */
  | { type: "skipNextAttack" }
  /** 令目标下一次主动攻击的骰面上限降低。 */
  | { type: "penalizeNextAttackDieSides"; amount: number }
  /** 令目标下一次主动攻击的骰点总结果降低。 */
  | { type: "penalizeNextAttackRoll"; amount: number }
  | { type: "heal"; amount: number }
  /** 地图阶段放弃本次移动；战斗中使用则失去下一次地图移动。 */
  | { type: "forfeitMovement" }
  /**
   * 地图阶段专用，代替掷移动骰：自选点数（1 到当前移动骰上限），
   * 按普通移动的规则逐格前进——照样触发沿途的营地回血与守关门计次。
   */
  | { type: "chooseMovement" }
  /**
   * 地图阶段专用，代替掷移动骰：直接跃至前方 1 到 maxDistance 格处。
   * 和 chooseMovement 的区别是不逐格前进，途中的营地与守关门计次一概不触发，
   * 只结算最终停留的格子——这是"跳过"和"走过"的核心差异。
   */
  | { type: "teleport"; maxDistance: number }
  /**
   * 地图阶段专用，代替掷移动骰：直接传送到当前所在阶段地图上的任意一格，
   * 不受距离限制。和 teleport 同理，只结算落点本身，不触发沿途任何效果。
   */
  | { type: "teleportAnywhere" }
  /**
   * 地图阶段专用，代替掷移动骰：不掷骰，直接沿环路前进固定格数。
   * 走的是逐格前进那条路（营地回血、守关门计次照旧），落点照常结算。
   */
  | { type: "advanceTiles"; distance: number }
  /** 代替移动，回到当前阶段营地并增加一圈进度。 */
  | { type: "returnToCamp" }
  /** 代替移动，回到自己上一次停留的同阶段格子并重新结算落点。 */
  | { type: "returnToPreviousPosition" }
  /**
   * 地图阶段专用：先让出牌者挑一名其他玩家，再对他施加 apply。
   *
   * 会把结算暂停在一个选择阶段，所以一张牌上只能有这一条效果——
   * 排在它后面的效果永远走不到。
   */
  | { type: "targetPlayer"; apply: TargetedScrollEffect }
  | { type: "custom"; resolve: ScrollEffectResolver };

/**
 * 选定目标之后施加在目标身上的效果。
 *
 * 单独成一个联合而不是混进主联合：它们只能经 targetPlayer 抵达，
 * 混在一起会让「有没有选人」这件事在两处 switch 里互相渗漏。
 */
export type TargetedScrollEffect =
  | {
      /** 从目标身上抢钱；对方不够就有多少抢多少，不会抢成负数。 */
      type: "stealGold";
      amount: number;
    }
  | {
      /** 钉死目标下一次掷骰移动的点数 */
      type: "forceMovementRoll";
      value: number;
    }
  | {
      /**
       * 把目标沿环路往回挪若干格。
       *
       * 只改位置，不结算落点：resolveTile 是围绕 activePlayerId 写的，替别人
       * 结算格子会把战斗、商店这些阶段挂到错误的人头上。倒退也刻意不计守关门
       * 圈数——否则来回推人就能刷出首领挑战资格。
       */
      type: "pushBack";
      distance: number;
    }
  | {
      /**
       * 与目标交换位置，代替本次移动。只有出牌者会结算换到的新格子。
       *
       * 候选名单会被收窄到同一区域内：跨区域换位等于绕开守关门和阶段首领
       * 白拿进度，那是比这张牌本身大得多的规则漏洞。
       */
      type: "swapPositions";
    }
  | {
      /** 代替本次移动，直接与目标开始 PvP；双方棋子位置都不改变。 */
      type: "startPvpBattle";
    }
  | {
      /** 从目标手中随机抽走一张卷轴；只有仍持有卷轴的玩家可以成为目标。 */
      type: "stealRandomScroll";
    }
  | {
      /** 让目标进入自选弃牌阶段，弃掉自己的一张卷轴。 */
      type: "forceDiscardScroll";
    }
  | {
      /** 目标下一次掷骰移动结果减少 amount，最低为 1。 */
      type: "penalizeMovementRoll";
      amount: number;
    };

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
 * 攻防双方都完成投骰后的装备上下文。
 *
 * 这个时机专门承载“自己的攻击骰点数高于对方防御骰点数”一类能力：普通
 * afterRoll 只能看到持有者自己的骰子，无法安全地比较对手结果。
 */
export interface EquipmentOpposedRollContext extends BattleEffectContext {
  player: Player;
  item: OwnedEquipment;
  attackRoll: RollResult;
  defenseRoll: RollResult;
  /** 追加伤害写入攻击方的本次修正，随后仍会经过防守方的受伤钩子。 */
  modifiers: RollModifiers;
  /** 使用游戏种子流，保证回放与联机结果一致。 */
  random: () => number;
}

/** 双方投骰后提供给防守方装备的上下文；修正写入本次防御。 */
export interface EquipmentDefensiveOpposedRollContext extends BattleEffectContext {
  player: Player;
  item: OwnedEquipment;
  attackRoll: RollResult;
  defenseRoll: RollResult;
  modifiers: RollModifiers;
}

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
  /**
   * 开战时的随机源，用于"随机二选一"这类效果。
   *
   * 由上下文给出而不是让卡牌自己 import：这里必须是 GameState 上那条种子流，
   * 换成 Math.random 的话同一局在两台机器上会分叉，replay 和联机都对不上。
   * 地图事件抽取走的也是同一个套路（`pickMapEvent(region, () => nextRandom(state))`）。
   */
  random: () => number;
  addBattleLog: (text: string) => void;
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
  /** 把这一次伤害压到不超过 max。 */
  capDamage: (max: number) => void;
  /**
   * 保证这次伤害结算后至少剩 hp 点生命，用于致命拦截。
   *
   * 若目标当前生命已经低于该下限，伤害会先被压到 0，再补足生命；因此也能表达
   * “受到致命伤害时恢复至一定生命”的复苏类效果。
   */
  keepAtLeast: (hp: number) => void;
  addBattleLog: (text: string) => void;
}

/**
 * 刚打出一张卷轴。每张牌各调用一次，牌已经离手了。
 *
 * 这是唯一一个战斗和地图**都会**触发的钩子——卷轴两个地方都能用，
 * 而「每次使用道具后……」这类代价不该只在战斗里收。两处的血账本不一样
 * （战斗读 battle.hpA / hpB，地图读 player.hp），所以扣血由调用方接好的
 * loseHp 负责，卡牌不必自己分辨自己在哪。
 */
export interface EquipmentScrollUseContext {
  state: GameState;
  player: Player;
  item: OwnedEquipment;
  /** 刚打出的那张牌 */
  scroll: OwnedScroll["kind"];
  /** 在战斗里打出时是这一场；地图上使用时没有 */
  battle?: BattleState;
  /**
   * 扣血，并把 logLine 写进当前场合的记录。
   *
   * 战斗里可以把人扣倒，引擎会接着判负；地图上至少保留 1 点——
   * 那边根本没有"倒下"这个状态，山路落石也是同一个约定。
   */
  loseHp: (amount: number, logLine: string) => void;
}

/**
 * 通用 modifier 表达不了的装备逻辑，直接写在卡牌定义的 effects 上。
 * 和卷轴的 custom 同理：定义不进 GameState，放函数是安全的。
 */
export interface EquipmentEffects {
  /** 在指定战斗时机禁止使用卷轴；空选择仍可正常提交并继续投骰。 */
  blockedScrollTimings?: readonly ScrollTiming[];
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
  /** 攻击方与防守方都完成投骰后，仅对攻击方装备调用。 */
  afterOpposedRoll?: (context: EquipmentOpposedRollContext) => void;
  /** 攻击方与防守方都完成投骰后，仅对防守方装备调用。 */
  afterDefensiveOpposedRoll?: (context: EquipmentDefensiveOpposedRollContext) => void;
  /**
   * 伤害落地前，只对受击方调用。
   *
   * 与 afterRoll 的分工：afterRoll 站在自己那次投骰上，看不到对手的合计；
   * 这里站在结果上，看得到最终伤害和自己的剩余血量，但只能把伤害改小。
   */
  beforeDamage?: (context: EquipmentDamageContext) => void;
  /** 打出一张卷轴之后，战斗与地图两处都会触发。 */
  onScrollUsed?: (context: EquipmentScrollUseContext) => void;
  onEquip?: (context: EquipmentLifecycleContext) => void;
  onUnequip?: (context: EquipmentLifecycleContext) => void;
}
