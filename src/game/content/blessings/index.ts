import { pickWeighted } from "../weighted";
import { defineBlessings, type BlessingDefinition } from "./definition";

export { defineBlessings } from "./definition";
export type { BlessingDefinition } from "./definition";

/**
 * 赐福内容池。
 *
 * 点石成金依赖尚未实现的金币系统，先登记定义但不进入随机池。
 */
export const BLESSINGS = defineBlessings({
  giantStrength: {
    name: "巨人之力",
    description: "攻击永久 +3。",
    weight: 1,
    modifiers: [{ type: "statBonus", stat: "attack", value: 3 }],
  },
  dragonScale: {
    name: "龙鳞护体",
    description: "防御永久 +3。",
    weight: 1,
    modifiers: [{ type: "statBonus", stat: "defense", value: 3 }],
  },
  favoredByFate: {
    name: "命运垂青",
    description: "攻击骰和防御骰的每颗骰子最低视为 3 点。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "minimumCombatRoll", value: 3 }],
  },
  windrunner: {
    name: "逐风者",
    description: "移动骰结果 +1。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "movementRollBonus", value: 1 }],
  },
  warTycoon: {
    name: "战争财阀",
    description: "每次赢得非 Boss 的 PvE 战斗后，额外获得 1 张随机卷轴。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "extraPveVictoryScroll", count: 1 }],
  },
  treasureHunter: {
    name: "宝物猎人",
    description: "开启宝箱时，额外获得 1 件随机装备。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "extraTreasureEquipment", count: 1 }],
  },
  unyieldingWill: {
    name: "不屈意志",
    description: "相遇战战败时免除正常惩罚，改为损失 1 点真实生命，最低保留 1 点。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "replacePvpPenaltyWithHpLoss", amount: 1 }],
  },
  midasTouch: {
    name: "点石成金",
    description: "获得的金币增加 20%（等待金币系统）。",
    weight: 1,
    enabled: false,
    modifiers: [],
    effects: [{ type: "goldGainMultiplier", multiplier: 1.2 }],
  },
});

/** 增加定义后会自动收窄成所有赐福键的联合类型。 */
export type BlessingKind = keyof typeof BLESSINGS;

const blessingTable: Readonly<Record<string, BlessingDefinition>> = BLESSINGS;

export function blessingDefinition(kind: BlessingKind): BlessingDefinition {
  return blessingTable[kind];
}

export function pickBlessingKind(random: () => number): BlessingKind | undefined {
  const kinds = (Object.keys(BLESSINGS) as BlessingKind[]).filter(
    (kind) => blessingDefinition(kind).enabled !== false,
  );
  if (kinds.length === 0) return undefined;
  return pickWeighted(
    kinds.map((kind) => [kind, blessingDefinition(kind).weight] as const),
    random,
  );
}
