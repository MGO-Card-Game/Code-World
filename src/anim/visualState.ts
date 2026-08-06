import type { BattleState, CombatSide, GameEvent, PlayerStats } from "../game/types";

/**
 * 把“引擎的最新数值”换算成“此刻应该显示的数值”。
 *
 * 规则引擎是原子结算的：按钮一点，血量、位置就已经是最终值了。
 * 但动画要按事件顺序逐条播，所以还没播到的事件必须把对应的量按住在它的 from 值上。
 *
 * 做法是找**最早一条**还没播的、影响该数值的事件，显示它的 from：
 *
 *   队列: [playerHpChanged 18→13] [playerHpChanged 13→9]
 *   显示: 18（按住）
 *   播完第一条后队列只剩第二条 → 显示 13 → 动画库从 18 补间到 13
 *   全部播完 → 显示引擎真实值 9
 *
 * 因为事件自带 from/to，界面不需要重建任何中间状态，
 * 只要在“最新 state”和“最早未播事件的 from”之间二选一即可。
 */

/** 玩家真实生命值 */
export function visualHp(player: PlayerStats, pending: readonly GameEvent[]) {
  const held = pending.find(
    (event) => event.type === "playerHpChanged" && event.playerId === player.id,
  );
  return held && held.type === "playerHpChanged" ? held.from : player.hp;
}

/** 玩家生命上限（生命护符会改） */
export function visualMaxHp(player: PlayerStats, pending: readonly GameEvent[]) {
  const held = pending.find(
    (event) => event.type === "maxHpChanged" && event.playerId === player.id,
  );
  return held && held.type === "maxHpChanged" ? held.from : player.maxHp;
}

/** 玩家在棋盘上的位置。移动和战败后退都会改 */
export function visualPosition(player: PlayerStats, pending: readonly GameEvent[]) {
  const held = pending.find(
    (event) =>
      (event.type === "playerMoved" || event.type === "playerRetreated") &&
      event.playerId === player.id,
  );
  if (held?.type === "playerMoved" || held?.type === "playerRetreated") {
    return held.from;
  }
  return player.position;
}

/** 战斗内的临时生命值。PvP 时不等于真实生命值 */
export function visualBattleHp(
  battle: BattleState,
  side: CombatSide,
  pending: readonly GameEvent[],
) {
  const held = pending.find(
    (event) => event.type === "battleDamage" && event.targetSide === side,
  );
  if (held?.type === "battleDamage") return held.hpBefore;
  return side === "a" ? battle.hpA : battle.hpB;
}

/**
 * 战斗轮次与攻防归属。
 *
 * 引擎在结算的同一瞬间就把 attacker 翻给了下一轮，而攻防骰、伤害的动画还没播。
 * 不按住的话，玩家会看到"自己打出的 D20"标在已经切换成攻击方的对手头上。
 */
function heldRoundAdvance(pending: readonly GameEvent[]) {
  const held = pending.find((event) => event.type === "battleRoundAdvanced");
  return held?.type === "battleRoundAdvanced" ? held : undefined;
}

export function visualBattleRound(battle: BattleState, pending: readonly GameEvent[]) {
  return heldRoundAdvance(pending)?.fromRound ?? battle.round;
}

export function visualAttacker(battle: BattleState, pending: readonly GameEvent[]) {
  return heldRoundAdvance(pending)?.fromAttacker ?? battle.attacker;
}

/**
 * 战斗弹层是否还要留在屏幕上。
 *
 * 决出胜负的那一次结算里，引擎在吐出 attackRolled / battleDamage 的同时就把 phase
 * 切走了（PvE 直接进 turnComplete）。照 phase 渲染的话，弹层会赶在这批动画之前退场，
 * 最后一轮就变成"骰子格子空着、血却已经掉了"。battleEnded 播完才是真正该退场的时刻。
 */
export function isBattleEnding(current: GameEvent | null, pending: readonly GameEvent[]) {
  return current?.type === "battleEnded" || pending.some((e) => e.type === "battleEnded");
}

/**
 * 把这一批事件里的战斗伤害补进快照。
 *
 * 战斗结束时不会再有 resetChoices，界面手上的 battle 快照停在结算之前，
 * 不补的话最后一击打完血条还停在挨打前的数值。
 */
export function battleWithDamage(
  battle: BattleState,
  events: readonly GameEvent[],
): BattleState {
  let hpA = battle.hpA;
  let hpB = battle.hpB;
  for (const event of events) {
    if (event.type !== "battleDamage") continue;
    if (event.targetSide === "a") hpA = event.hpAfter;
    else hpB = event.hpAfter;
  }
  return hpA === battle.hpA && hpB === battle.hpB ? battle : { ...battle, hpA, hpB };
}

/**
 * 卷轴/装备是否应该已经出现在界面上。
 *
 * 获得类事件播完之前先不渲染，免得卡牌在“获得”动画播之前就凭空出现在手牌里。
 */
export function isRevealed(instanceId: string, pending: readonly GameEvent[]) {
  return !pending.some(
    (event) =>
      (event.type === "scrollGranted" ||
        event.type === "equipmentGranted" ||
        event.type === "scrollTransferred" ||
        event.type === "equipmentTransferred") &&
      event.instanceId === instanceId,
  );
}

/** 正在播放的伤害事件，用于飘伤害数字 */
export function activeDamage(event: GameEvent | null) {
  return event?.type === "battleDamage" ? event : null;
}
