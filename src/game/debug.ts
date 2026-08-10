import type {
  EquipmentKind,
  GameState,
  OwnedEquipment,
  OwnedScroll,
  PlayerId,
  ScrollKind,
} from "./types";
import {
  EQUIPMENT,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
} from "./content/equipment";
import { SCROLLS } from "./content/scrolls";
import { cloneGameState } from "./state";

/**
 * 调试用的状态工具。
 *
 * 刻意**不做成 GameAction**：调试动作一旦进了 action 联合类型，就意味着
 * 客户端可以把它发给服务器，届时只能靠 canAct 里的一行判断挡住。
 * 做成纯状态变换、只在本地模式调用，它在结构上就到不了网络那一侧。
 *
 * 界面入口另有 import.meta.env.DEV 包裹，生产构建里不会出现。
 */

/** 目前已实现的全部卷轴种类。 */
export const ALL_SCROLL_KINDS = Object.keys(SCROLLS) as ScrollKind[];
export const ALL_EQUIPMENT_KINDS = Object.keys(EQUIPMENT) as EquipmentKind[];

function clone(state: GameState): GameState {
  return cloneGameState(state);
}

function makeScroll(state: GameState, kind: ScrollKind): OwnedScroll {
  const scroll = { instanceId: `dbg-scroll-${state.nextInstanceId}`, kind };
  state.nextInstanceId += 1;
  return scroll;
}

/** 给某位玩家发指定种类的卷轴 */
export function debugGrantScroll(
  state: GameState,
  playerId: PlayerId,
  kind: ScrollKind,
  count = 1,
): GameState {
  const next = clone(state);
  const player = next.players[playerId];
  for (let index = 0; index < count; index += 1) {
    player.scrolls.push(makeScroll(next, kind));
  }
  next.lastEvents = [];
  return next;
}

/** 每种卷轴各发若干张，用来观察手牌扇形与战斗选牌 */
export function debugStockHand(
  state: GameState,
  playerId: PlayerId,
  perKind = 3,
): GameState {
  const next = clone(state);
  const player = next.players[playerId];
  for (const kind of ALL_SCROLL_KINDS) {
    for (let index = 0; index < perKind; index += 1) {
      player.scrolls.push(makeScroll(next, kind));
    }
  }
  next.lastEvents = [];
  return next;
}

export function debugClearScrolls(state: GameState, playerId: PlayerId): GameState {
  const next = clone(state);
  next.players[playerId].scrolls = [];
  next.lastEvents = [];
  return next;
}

/**
 * 按槽位依次装入装备。生命上限修正按配置同步处理，
 * 避免调试状态违反正式规则或与正常属性计算不一致。
 */
export function debugGrantEquipment(state: GameState, playerId: PlayerId): GameState {
  const next = clone(state);
  const player = next.players[playerId];
  for (const kind of ALL_EQUIPMENT_KINDS) {
    const category = equipmentCategory(kind);
    const occupied = player.equipment.filter(
      (item) => equipmentCategory(item.kind) === category,
    ).length;
    if (occupied >= EQUIPMENT_SLOT_LIMITS[category]) continue;
    const item: OwnedEquipment = {
      instanceId: `dbg-equip-${next.nextInstanceId}`,
      kind,
    };
    next.nextInstanceId += 1;
    player.equipment.push(item);
    const maxHpBonus = EQUIPMENT[kind].modifiers
      .filter((modifier) => modifier.type === "maxHp")
      .reduce((sum, modifier) => sum + modifier.value, 0);
    if (maxHpBonus > 0) {
      player.maxHp += maxHpBonus;
      player.hp = Math.min(player.maxHp, player.hp + maxHpBonus);
    }
  }
  next.lastEvents = [];
  return next;
}

/** 直接设置生命值，方便快速造出濒死或满血局面 */
export function debugSetHp(state: GameState, playerId: PlayerId, hp: number): GameState {
  const next = clone(state);
  const player = next.players[playerId];
  player.hp = Math.max(1, Math.min(player.maxHp, hp));
  next.lastEvents = [];
  return next;
}

/** 把棋子挪到指定格子，用来直接测试某一类格子的效果 */
export function debugMoveTo(
  state: GameState,
  playerId: PlayerId,
  tileIndex: number,
): GameState {
  const next = clone(state);
  next.players[playerId].position = Math.max(
    0,
    Math.min(next.map.tiles.length - 1, tileIndex),
  );
  next.lastEvents = [];
  return next;
}
