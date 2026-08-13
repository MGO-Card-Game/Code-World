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

/** 玩家基础攻击/防御；永久成长事件播放前保持旧值。 */
export function visualBaseStat(
  player: PlayerStats,
  stat: "attack" | "defense",
  pending: readonly GameEvent[],
) {
  const held = pending.find(
    (event) =>
      event.type === "baseStatChanged"
      && event.playerId === player.id
      && event.stat === stat,
  );
  if (held?.type === "baseStatChanged") return held.from;
  return stat === "attack" ? player.baseAttack : player.baseDefense;
}

/** 玩家金币；获得、消费或转移事件播到前保持旧余额。 */
export function visualGold(player: PlayerStats, pending: readonly GameEvent[]) {
  const held = pending.find(
    (event) => event.type === "goldChanged" && event.playerId === player.id,
  );
  return held?.type === "goldChanged" ? held.from : player.gold;
}

/** 玩家在棋盘上的位置。移动和 PvE 战败回退都会改。 */
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
    (event) =>
      (event.type === "battleDamage" || event.type === "battleHealed") &&
      event.targetSide === side,
  );
  if (held?.type === "battleDamage" || held?.type === "battleHealed") return held.hpBefore;
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
 * 把队列的事件窗口收敛到当前这一场战斗。
 *
 * 队列的 seen 是跨动作的滚动窗口，里面可能还留着上一场战斗的骰点：最后一轮不会有
 * battleRoundAdvanced（finishBattle 提前返回），visualRoll 的清空条件对它不成立，
 * 那条骰点就会一直留在窗口里，等下一场战斗开打、自己的骰还没投出来时先亮出来。
 * 从最近一条 battleStarted 切一刀，跨场泄漏就不可能发生。
 */
export function battleTimeline(seen: readonly GameEvent[]): readonly GameEvent[] {
  for (let index = seen.length - 1; index >= 0; index -= 1) {
    if (seen[index].type === "battleStarted") return seen.slice(index);
  }
  return seen;
}

type RollEvent = Extract<GameEvent, { type: "attackRolled" | "defenseRolled" }>;

function isRollEvent(event: GameEvent): event is RollEvent {
  return event.type === "attackRolled" || event.type === "defenseRolled";
}

/**
 * 此刻该显示的攻防骰点。
 *
 * 骰点只存在于事件里——引擎的 BattleState 不记上一次投骰，所以这里要从
 * 「队列见过的事件 + 还没播到的事件」算出当下该显示什么。
 *
 * `events` 必须来自播放队列（battleTimeline(playback.seen)），**不能**是
 * `state.lastEvents`：后者是逐动作的窗口，联机时别人的下一个动作就能在动画播到一半时
 * 把它换掉，骰子会当场消失而血照掉——两者的寿命不一样，见 eventQueue.seen。
 *
 * 关键是**不要**让界面在事件恰好成为"当前"的那一帧把骰点抄进局部 state：抄的那一帧
 * 一旦错过（按了跳过演出、两次广播被合进同一次渲染、弹层重新挂载），那一轮的骰子就
 * 永久空着，而引擎状态早已是最终值。派生出来的值没有这个窗口——错过动画只意味着
 * 直接显示终值。
 *
 * 两条边界，都用 pending 判断：
 * - 投骰事件还在 pending 里 = 动画没播到，按住不显示；
 * - 它后面那条 battleRoundAdvanced 已经播完 = 已经交接到下一轮，清空。
 *   最后一轮不会有交接事件（finishBattle 提前返回），所以骰点会留到弹层退场。
 */
export function visualRoll(
  role: "attack" | "defense",
  events: readonly GameEvent[],
  pending: readonly GameEvent[],
): RollEvent | undefined {
  const wanted = role === "attack" ? "attackRolled" : "defenseRolled";
  const played = (id: number) => !pending.some((event) => event.id === id);
  /*
    取**已经播过**的最后一条。一批事件里同一种投骰不再只有一条——「动作如潮」
    这类效果会让一个回合连结算两次攻击。直接取最后一条的话，第一击的动画期间
    那条还在 pending，骰子格会空着，等第二击播到才突然出现。
  */
  const roll = events
    .filter(isRollEvent)
    .filter((event) => event.type === wanted && played(event.id))
    .at(-1);
  if (!roll) return undefined;

  const advanced = events.find(
    (event) => event.type === "battleRoundAdvanced" && event.id > roll.id,
  );
  if (advanced && played(advanced.id)) return undefined;
  return roll;
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
    if (event.type !== "battleDamage" && event.type !== "battleHealed") continue;
    if (event.targetSide === "a") hpA = event.hpAfter;
    else hpB = event.hpAfter;
  }
  return hpA === battle.hpA && hpB === battle.hpB ? battle : { ...battle, hpA, hpB };
}

/**
 * 卷轴、装备或赐福是否应该已经出现在界面上。
 *
 * 获得类事件播完之前先不渲染，免得卡牌在“获得”动画播之前就凭空出现在手牌里。
 */
export function isRevealed(instanceId: string, pending: readonly GameEvent[]) {
  return !pending.some(
    (event) =>
      (event.type === "scrollGranted" ||
        event.type === "equipmentGranted" ||
        event.type === "blessingGranted" ||
        event.type === "scrollTransferred" ||
        event.type === "equipmentTransferred" ||
        event.type === "blessingTransferred") &&
      event.instanceId === instanceId,
  );
}

/** 正在播放的伤害事件，用于飘伤害数字 */
export function activeDamage(event: GameEvent | null) {
  return event?.type === "battleDamage" ? event : null;
}

/** 正在播放的战斗治疗事件，用于飘回血数字 */
export function activeHealing(event: GameEvent | null) {
  return event?.type === "battleHealed" ? event : null;
}
