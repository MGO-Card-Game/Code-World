import type { MapRegionId, ScrollKind, TileType, TimedStatPenalty } from "../../types";
import type { EquipmentCategory } from "../equipment/definition";
import type { RewardRarityTier } from "../rarity";

export type MapEventCategory = "recovery" | "hazard" | "reward" | "boon" | "casino";
export type MapEventResource = "scroll" | "equipment" | "random";
export type MapEventBaseStat = "attack" | "defense";

/**
 * 一个可以由掷骰决定的数值。
 *
 * 写成数字就是固定值；写成 `{ dice, sides }` 由引擎在结算时掷骰。掷骰必须由引擎
 * 走 state 的随机流，不能在配置里自己 Math.random——同种子重放和联机双端要得到
 * 同一个结果，靠的就是「谁消耗随机数、消耗几个」是确定的。
 */
export type MapEventAmount =
  | number
  | {
      dice: number;
      sides: number;
      /** 掷骰点数之和再乘这个系数，默认 1。金钱雨这类「点数 × 单位」用得到。 */
      multiplier?: number;
    };

export interface AmountNarrationContext {
  playerName: string;
  /** 实际变化量，已经经过生命上下限与金币倍率折算。 */
  amount: number;
  /**
   * 掷骰点数之和；固定数值的效果没有这一项。
   *
   * 和 amount 分开是因为两者经常对不上：温泉掷出 9 点但只差 3 点满血时，
   * 玩家该看到的是「掷出 9，恢复 3」，而不是凭空少掉的 6 点。
   */
  roll?: number;
}

export interface RewardNarrationContext {
  playerName: string;
  /** 私有旁白传具体牌名，公开旁白传“一张卷轴”等脱敏名称。 */
  rewardName: string;
}

export interface BaseStatNarrationContext {
  playerName: string;
  stat: MapEventBaseStat;
  /**
   * 实际变化量，可正可负，已经过下限折算。
   *
   * 配置想扣 1 点但玩家的基础值已经是 0 时，这里会是 0——文案该照它写，
   * 不然会出现「防御下降 1 点」但面板上数字没动的情况。
   */
  amount: number;
}

/** 交出卷轴的一方；拿来主义这类跨玩家效果按人各写一条旁白。 */
export interface DonorNarrationContext {
  playerName: string;
  donorName: string;
}

export interface PlayerNarrationContext {
  playerName: string;
}

export interface EquipmentExchangeNarrationContext {
  playerName: string;
  equipmentName: string;
  /** 实际增加的基础防御。 */
  amount: number;
}

export interface TeleportNarrationContext {
  playerName: string;
  tileLabel: string;
}

export interface PaidTravelNarrationContext extends TeleportNarrationContext {
  price: number;
}

export interface StatConversionNarrationContext {
  playerName: string;
  fromStat: MapEventBaseStat;
  toStat: MapEventBaseStat;
  amount: number;
}

/**
 * 地图事件可复用的即时效果词汇。
 *
 * 新事件优先组合这些效果，让生命边界、结构化事件和暗牌文案只在引擎实现一次。
 * 等真正出现无法表达的特殊事件时，再像卷轴一样增加 custom 逃生口。
 */
export type MapEventEffectDefinition =
  | {
      type: "heal";
      amount: MapEventAmount;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      type: "damage";
      amount: MapEventAmount;
      /** 默认保留至少 1 点生命，维持当前事件格不会直接击败玩家的规则。 */
      minimumHp?: number;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      type: "grantResource";
      resource: MapEventResource;
      narration: (context: RewardNarrationContext) => string;
    }
  | {
      /**
       * 指名发牌，和 grantResource 的随机发放分工明确：kind 是必填的。
       *
       * 事件专属牌（drawable: false）只能由这里发出去——写成随机卷轴的话，
       * 宝箱和战斗奖励也会开始掉这张牌，事件的独占性就没了。
       */
      type: "grantScroll";
      kind: ScrollKind;
      /** 发放张数，默认 1；每一张各产生一条旁白，暗牌裁剪逐条生效。 */
      count?: number;
      narration: (context: RewardNarrationContext) => string;
    }
  | {
      /**
       * 让玩家的下一次地图行动失去移动机会，和战地药剂的代价共用同一个字段。
       *
       * reason 会直接出现在回合开始的旁白里，所以填的是给玩家看的短语。
       */
      type: "skipNextMovement";
      reason: string;
      narration: (context: PlayerNarrationContext) => string;
    }
  | {
      /**
       * 永久改动基础攻防，可正可负。
       *
       * 负数会被引擎拦在 0 以上：这套结算是攻防相减，基础值一旦为负，每一次
       * 交手都在白送伤害，和「事件不会直接击败玩家」是同一条底线。
       */
      type: "adjustBaseStat";
      stat: MapEventBaseStat;
      amount: number;
      narration: (context: BaseStatNarrationContext) => string;
    }
  | {
      /** 按玩家自己的完整回合计时；同 kind 再次施加时刷新持续时间。 */
      type: "applyTimedStatPenalty";
      kind: TimedStatPenalty["kind"];
      attack: number;
      defense: number;
      turns: number;
      narration: (context: PlayerNarrationContext) => string;
    }
  | {
      type: "grantGold";
      amount: MapEventAmount;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      /**
       * 按当前余额的百分比扣钱。
       *
       * 刻意不做固定额：固定额对刚开局和攒了一路的玩家份量差太远，而这类事件
       * 想要的是「按身家收费」。真需要固定额时再加一种数值形状。
       */
      type: "loseGold";
      percent: number;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      /**
       * 向其余每名玩家各收取一张随机卷轴；手上没牌的人自动跳过。
       *
       * 交出哪一张由引擎随机决定，不劳玩家选——让每位对手依次挑牌需要一个多人
       * 轮流出牌的阶段（形状接近 tradeOffer），那是另一件事，不该塞进事件结算。
       */
      type: "takeScrollFromEachOpponent";
      narration: (context: DonorNarrationContext) => string;
      /**
       * 一张都没收到时的旁白。必填而不是可选：漏掉它时踩中这一格的玩家会看到
       * 事件格毫无反应——没有旁白、没有结构化事件，和卡住了没法区分。
       */
      emptyNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      /**
       * 让玩家从自己的手牌中选择一张卷轴，并获得一个新的同名实例。
       *
       * 选择必须跨 action 完成，所以这条效果会接管阶段；手牌为空时则直接走
       * emptyNarration，不打开一个没有选项的弹层。
       */
      type: "duplicateOwnedScroll";
      narration: (context: PlayerNarrationContext) => string;
      selectedNarration: (context: RewardNarrationContext) => string;
      emptyNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      /** 可选地交出一件已有装备，换取永久基础防御。 */
      type: "exchangeEquipmentForDefense";
      defenseBonus: number;
      narration: (context: PlayerNarrationContext) => string;
      acceptedNarration: (context: EquipmentExchangeNarrationContext) => string;
      declinedNarration: (context: PlayerNarrationContext) => string;
      emptyNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      /** 在当前区域的环路内，沿前进方向传送到下一处指定类型的格子。 */
      type: "teleportToNextTile";
      tileType: TileType;
      narration: (context: TeleportNarrationContext) => string;
      emptyNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      /** 可选地支付固定金币，沿当前区域的前进方向移动到最近的指定格。 */
      type: "offerPaidTravelToNextTile";
      tileType: TileType;
      price: number;
      narration: (context: PaidTravelNarrationContext) => string;
      acceptedNarration: (context: PaidTravelNarrationContext) => string;
      declinedNarration: (context: PaidTravelNarrationContext) => string;
      emptyNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      /** 可选地把固定点数的基础攻击与基础防御向任一方向转换。 */
      type: "offerBaseStatConversion";
      amount: number;
      narration: (context: PlayerNarrationContext) => string;
      convertedNarration: (context: StatConversionNarrationContext) => string;
      declinedNarration: (context: PlayerNarrationContext) => string;
    }
  | {
      type: "grantEquipment";
      category?: EquipmentCategory;
      /** 直接引用统一的品质档位；省略时用通用档。 */
      quality?: RewardRarityTier;
      narration: (context: RewardNarrationContext) => string;
    }
  | {
      /**
       * 赌场转盘的逃生口：进店后玩家可反复付费转动，不是一次性即时效果，
       * 表达不了声明式效果列表的“一次结算完就轮到下一格”约定，所以只负责
       * 把 phase 切到 casino，具体的转动/离场由 casino.ts 的两个动作处理。
       */
      type: "enterCasino";
      narration: (context: PlayerNarrationContext) => string;
    };

/** 一个事件的内容定义；category 由所在文件盖章，不在每条事件上重复声明。 */
export interface MapEventBody {
  name: string;
  description: string;
  /** 各区域的相对抽取权重；未声明或不为正数时不进入该区域事件池。 */
  regions: Partial<Record<MapRegionId, number>>;
  /** 按数组顺序即时结算；可能发放装备的效果应放在最后。 */
  effects: readonly MapEventEffectDefinition[];
}

export type MapEventDefinition = MapEventBody & { category: MapEventCategory };

export function defineMapEvents<
  C extends MapEventCategory,
  T extends Record<string, MapEventBody>,
>(category: C, table: T): { [K in keyof T]: T[K] & { category: C } } {
  return Object.fromEntries(
    Object.entries(table).map(([kind, body]) => [kind, { ...body, category }]),
  ) as { [K in keyof T]: T[K] & { category: C } };
}
