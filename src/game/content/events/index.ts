import type { MapRegionId } from "../../types";
import { pickWeighted } from "../weighted";
import type { MapEventDefinition } from "./definition";
import { HAZARD_EVENTS } from "./hazards";
import { RECOVERY_EVENTS } from "./recovery";
import { REWARD_EVENTS } from "./rewards";

export {
  defineMapEvents,
  type AmountNarrationContext,
  type MapEventBody,
  type MapEventCategory,
  type MapEventDefinition,
  type MapEventEffectDefinition,
  type MapEventResource,
  type RewardNarrationContext,
} from "./definition";

/** 合并顺序也决定同权重事件在随机区间内的顺序；不要无故调整。 */
export const MAP_EVENTS = {
  ...RECOVERY_EVENTS,
  ...HAZARD_EVENTS,
  ...REWARD_EVENTS,
};

export type MapEventKind = keyof typeof MAP_EVENTS;

export function mapEventDefinition(kind: MapEventKind): MapEventDefinition {
  return MAP_EVENTS[kind];
}

/** 某区域实际参与抽取的事件及其正权重，导出供结构测试和调试面板使用。 */
export function mapEventPool(region: MapRegionId) {
  return (Object.keys(MAP_EVENTS) as MapEventKind[])
    .map((kind) => [kind, MAP_EVENTS[kind].regions[region] ?? 0] as const)
    .filter(([, weight]) => weight > 0);
}

/** 按区域相对权重抽取事件，只消耗一个随机数。 */
export function pickMapEvent(region: MapRegionId, random: () => number): MapEventKind {
  const pool = mapEventPool(region);
  if (pool.length === 0) throw new Error(`区域 ${region} 没有可触发的地图事件`);
  return pickWeighted(pool, random);
}
