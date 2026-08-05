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
  scrollGranted: 560,
  scrollConsumed: 440,
  scrollTransferred: 620,
  equipmentGranted: 620,
  equipmentTransferred: 620,
  battleStarted: 700,
  initiativeRolled: 760,
  attackRolled: 640,
  defenseRolled: 640,
  battleDamage: 560,
  battleRoundAdvanced: 300,
  battleEnded: 700,
  gameOver: 600,
};

export interface QueuedEvent {
  event: GameEvent;
  duration: number;
}

export interface EventQueueState {
  current: QueuedEvent | null;
  /** 当前事件已播放的毫秒数 */
  elapsed: number;
  pending: QueuedEvent[];
  /**
   * 已入队事件 id 的水位线。
   * 引擎的事件 id 全局单调递增，因此同一批事件被重复喂进来时可以直接按 id 过滤，
   * 界面重渲染不会导致同一条动画播两遍。
   */
  watermark: number;
}

export function createEventQueue(): EventQueueState {
  return { current: null, elapsed: 0, pending: [], watermark: 0 };
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
      watermark: highest,
    });
  }

  const fresh = events.filter((event) => event.id > state.watermark);
  if (fresh.length === 0) return state;
  return promote({
    ...state,
    pending: [...state.pending, ...fresh.map((event) => toQueued(event, speed))],
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

/** 跳过动画，立刻清空队列（界面上的“跳过”按钮） */
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
