import type { GameEvent } from "../game/types";

/**
 * 事件播放队列（纯逻辑，不依赖 React）。
 *
 * 规则引擎是原子结算的：一次 action 立刻算完所有结果，并吐出一串描述
 * “发生了什么、顺序如何”的事件。队列的职责就是把这一串事件重新摊回时间轴上，
 * 每次只把一条事件标记为“正在播放”，界面据此播对应的动画片段。
 *
 * 时间推进由外部驱动（React 里用 setTimeout，测试里直接喂毫秒数），
 * 因此这里没有任何计时器，可以完全同步地测试。
 */

/** 各类事件的默认播放时长（毫秒） */
export const DEFAULT_DURATIONS: Record<GameEvent["type"], number> = {
  narration: 420,
  gameStarted: 900,
  turnStarted: 320,
  movementRolled: 700,
  playerMoved: 520,
  playerRetreated: 620,
  playerHpChanged: 480,
  maxHpChanged: 380,
  baseStatChanged: 380,
  goldChanged: 380,
  scrollGranted: 560,
  scrollConsumed: 440,
  scrollTransferred: 620,
  equipmentGranted: 620,
  equipmentTransferred: 620,
  blessingGranted: 620,
  blessingTransferred: 620,
  battleStarted: 700,
  initiativeRolled: 760,
  attackRolled: 640,
  defenseRolled: 640,
  battleDamage: 560,
  battleHealed: 560,
  battleRoundAdvanced: 300,
  battleEnded: 700,
  gameOver: 600,
};

export interface QueuedEvent {
  event: GameEvent;
  duration: number;
}

/**
 * seen 保留的最大条数。一场战斗的事件量在几十条这个量级，200 足够覆盖当前这一场，
 * 又不会让窗口无限长下去。
 */
const SEEN_LIMIT = 200;

export interface EventQueueState {
  current: QueuedEvent | null;
  /** 当前事件已播放的毫秒数 */
  elapsed: number;
  pending: QueuedEvent[];
  /**
   * 队列见过的事件的滚动窗口：已播完的、正在播的、还没播的都在里面。
   *
   * 界面要回溯“刚刚播了什么”时必须用它，不能用 `state.lastEvents`——那是**逐动作**的
   * 窗口，引擎每接受一个动作就清空重填（engine.ts），联机时服务器又是每个动作广播一次。
   * 于是任何人的下一个动作都能在动画播到一半时把它换掉，靠它派生的东西（战斗骰点）
   * 会当场消失，而队列还在不紧不慢地播着前一批。队列自己看过的事件才和动画同寿。
   */
  seen: GameEvent[];
  /**
   * 已入队事件 id 的水位线。
   * 引擎的事件 id 全局单调递增，因此同一批事件被重复喂进来时可以直接按 id 过滤，
   * 界面重渲染不会导致同一条动画播两遍。
   */
  watermark: number;
}

export function createEventQueue(): EventQueueState {
  return { current: null, elapsed: 0, pending: [], seen: [], watermark: 0 };
}

function toQueued(event: GameEvent, speed: number): QueuedEvent {
  const base = DEFAULT_DURATIONS[event.type];
  if (speed <= 0) return { event, duration: 0 };
  return { event, duration: Math.max(0, Math.round(base / speed)) };
}

/** 当前没有事件在播时，把队首提上来 */
function promote(state: EventQueueState): EventQueueState {
  if (state.current || state.pending.length === 0) return state;
  const [next, ...rest] = state.pending;
  return { ...state, current: next, elapsed: 0, pending: rest };
}

/**
 * 把引擎产出的一批事件追加进队列。
 * speed > 1 表示加速播放，会等比压缩每条事件的时长。
 */
export function enqueue(
  state: EventQueueState,
  events: readonly GameEvent[],
  speed = 1,
): EventQueueState {
  if (events.length === 0) return state;
  const highest = events[events.length - 1].id;

  // 重开一局会把引擎的 nextEventId 归 1。id 倒退即视为新对局，
  // 直接丢掉上一局还没播完的动画，否则新开局会被旧队列堵住。
  if (highest < state.watermark) {
    return promote({
      current: null,
      elapsed: 0,
      pending: events.map((event) => toQueued(event, speed)),
      seen: events.slice(-SEEN_LIMIT),
      watermark: highest,
    });
  }

  const fresh = events.filter((event) => event.id > state.watermark);
  if (fresh.length === 0) return state;
  return promote({
    ...state,
    pending: [...state.pending, ...fresh.map((event) => toQueued(event, speed))],
    seen: [...state.seen, ...fresh].slice(-SEEN_LIMIT),
    watermark: highest,
  });
}

/**
 * 推进 deltaMs 毫秒。一帧内可能跨过多条短事件，因此这里是循环消费。
 */
export function advance(state: EventQueueState, deltaMs: number): EventQueueState {
  let next = promote(state);
  let remaining = Math.max(0, deltaMs);

  while (next.current) {
    const left = next.current.duration - next.elapsed;
    if (remaining < left) {
      return remaining === 0 ? next : { ...next, elapsed: next.elapsed + remaining };
    }
    remaining -= left;
    next = promote({ ...next, current: null, elapsed: 0 });
  }

  return next;
}

/**
 * 跳过动画，立刻清空队列（界面上的“跳过”按钮）。
 * seen 要留着：跳过之后界面仍然要显示末击的骰点，清掉就变成空格子了。
 */
export function drain(state: EventQueueState): EventQueueState {
  if (!state.current && state.pending.length === 0) return state;
  return { ...state, current: null, elapsed: 0, pending: [] };
}

export function isPlaying(state: EventQueueState) {
  return state.current !== null || state.pending.length > 0;
}

export function currentEvent(state: EventQueueState) {
  return state.current?.event ?? null;
}

/** 当前事件还需要多少毫秒播完；没有事件在播时返回 null */
export function remainingMs(state: EventQueueState) {
  if (!state.current) return null;
  return Math.max(0, state.current.duration - state.elapsed);
}

/** 当前事件的播放进度 0～1，可用于手写补间 */
export function progress(state: EventQueueState) {
  if (!state.current || state.current.duration === 0) return 1;
  return Math.min(1, state.elapsed / state.current.duration);
}

export function queueLength(state: EventQueueState) {
  return (state.current ? 1 : 0) + state.pending.length;
}

/**
 * 尚未播放的事件（不含正在播的那条）。
 *
 * 界面渲染的是引擎的最新 state，而结算是原子的——按钮一点，数值就已经是最终值了。
 * 为了让动画看起来对，还没播到的事件需要把对应的量“按住”在它的 from 值上，
 * 等真正播到时再放开，由动画库补间到最新 state。详见 visualState.ts。
 */
export function pendingEvents(state: EventQueueState): GameEvent[] {
  return state.pending.map((queued) => queued.event);
}

/**
 * 队列见过的事件窗口。
 *
 * 需要「按事件流回溯当下该显示什么」的地方一律用它配 pendingEvents，
 * 两者的分界就是“播到了没有”。见 EventQueueState.seen 与 visualState.visualRoll。
 */
export function seenEvents(state: EventQueueState): readonly GameEvent[] {
  return state.seen;
}
