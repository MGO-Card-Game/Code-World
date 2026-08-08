import type { MapRegionId } from "../../types";
import type { EquipmentCategory } from "../equipment/definition";

export type MapEventCategory = "recovery" | "hazard" | "reward" | "boon" | "casino";
export type MapEventResource = "scroll" | "equipment" | "random";
export type MapEventBaseStat = "attack" | "defense";

export interface AmountNarrationContext {
  playerName: string;
  /** 实际变化量，已经经过生命上下限折算。 */
  amount: number;
}

export interface RewardNarrationContext {
  playerName: string;
  /** 私有旁白传具体牌名，公开旁白传“一张卷轴”等脱敏名称。 */
  rewardName: string;
}

export interface BaseStatNarrationContext {
  playerName: string;
  stat: MapEventBaseStat;
  /** 实际增加量；引擎会把负数配置折算为 0。 */
  amount: number;
}

export interface PlayerNarrationContext {
  playerName: string;
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
      amount: number;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      type: "damage";
      amount: number;
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
      type: "increaseBaseStat";
      stat: MapEventBaseStat;
      amount: number;
      narration: (context: BaseStatNarrationContext) => string;
    }
  | {
      type: "grantGold";
      amount: number;
      narration: (context: AmountNarrationContext) => string;
    }
  | {
      type: "grantEquipment";
      category?: EquipmentCategory;
      quality?: "standard" | "high";
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
