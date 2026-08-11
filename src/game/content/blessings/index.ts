import { pickWeighted } from "../weighted";
import { defineBlessings, type BlessingDefinition } from "./definition";

export { defineBlessings } from "./definition";
export type { BlessingDefinition } from "./definition";

/**
 * 赐福内容池。
 *
 * 所有已登记赐福都进入随机池；经济相关效果由 economy.ts 统一结算。
 */
export const BLESSINGS = defineBlessings({
  giantStrength: {
    name: "巨人之力",
    description: "攻击永久 +2。",
    weight: 1,
    modifiers: [{ type: "statBonus", stat: "attack", value: 2 }],
  },
  dragonScale: {
    name: "龙鳞护体",
    description: "防御永久 +2。",
    weight: 1,
    modifiers: [{ type: "statBonus", stat: "defense", value: 2 }],
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
    description: "战败时不退回阶段营地，改为留在原地以半血复活。",
    weight: 1,
    modifiers: [],
    effects: [{ type: "respawnInPlaceOnDefeat" }],
  },
  midasTouch: {
    name: "点石成金",
    description: "通过战斗、宝箱和事件获得的金币增加 20%。",
    weight: 1,
    enabled: true,
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

export function pickBlessingKind(
  random: () => number,
  excluded: readonly BlessingKind[] = [],
): BlessingKind | undefined {
  const kinds = (Object.keys(BLESSINGS) as BlessingKind[]).filter(
    (kind) => blessingDefinition(kind).enabled !== false && !excluded.includes(kind),
  );
  if (kinds.length === 0) return undefined;
  return pickWeighted(
    kinds.map((kind) => [kind, blessingDefinition(kind).weight] as const),
    random,
  );
}
