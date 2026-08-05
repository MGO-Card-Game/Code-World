import { describe, expect, it } from "vitest";
import {
  advance,
  createEventQueue,
  currentEvent,
  DEFAULT_DURATIONS,
  drain,
  enqueue,
  isPlaying,
  progress,
  queueLength,
  remainingMs,
} from "./eventQueue";
import { createInitialGame, gameReducer } from "../game/engine";
import { resolveRound } from "../game/testSupport";
import type { GameEvent } from "../game/types";

function narration(id: number): GameEvent {
  return { id, type: "narration", text: `#${id}` };
}

function moved(id: number): GameEvent {
  return { id, type: "playerMoved", playerId: "player1", from: 0, to: 3 };
}

const NARRATION = DEFAULT_DURATIONS.narration;
const MOVED = DEFAULT_DURATIONS.playerMoved;

describe("事件播放队列", () => {
  it("入队后立刻把队首提为当前事件", () => {
    const queue = enqueue(createEventQueue(), [narration(1), narration(2)]);

    expect(currentEvent(queue)?.id).toBe(1);
    expect(queueLength(queue)).toBe(2);
    expect(isPlaying(queue)).toBe(true);
  });

  it("空队列不播放任何东西", () => {
    const queue = createEventQueue();

    expect(isPlaying(queue)).toBe(false);
    expect(currentEvent(queue)).toBeNull();
    expect(remainingMs(queue)).toBeNull();
  });

  it("按 id 去重，同一批事件重复入队不会播两遍", () => {
    const batch = [narration(1), narration(2)];
    let queue = enqueue(createEventQueue(), batch);
    queue = enqueue(queue, batch);
    queue = enqueue(queue, batch);

    expect(queueLength(queue)).toBe(2);
  });

  it("重复入队时返回同一个对象，避免触发无谓的重渲染", () => {
    const batch = [narration(1)];
    const queue = enqueue(createEventQueue(), batch);

    expect(enqueue(queue, batch)).toBe(queue);
    expect(enqueue(queue, [])).toBe(queue);
  });

  it("只接受水位线之上的新事件", () => {
    let queue = enqueue(createEventQueue(), [narration(1), narration(2)]);
    queue = enqueue(queue, [narration(2), narration(3)]);

    expect(queueLength(queue)).toBe(3);
    queue = advance(queue, NARRATION * 2);
    expect(currentEvent(queue)?.id).toBe(3);
  });

  it("时长不足时只累加进度，不切换事件", () => {
    let queue = enqueue(createEventQueue(), [narration(1), narration(2)]);
    queue = advance(queue, NARRATION / 2);

    expect(currentEvent(queue)?.id).toBe(1);
    expect(progress(queue)).toBeCloseTo(0.5);
    expect(remainingMs(queue)).toBe(NARRATION / 2);
  });

  it("一次推进可以跨过多条事件", () => {
    let queue = enqueue(createEventQueue(), [
      narration(1),
      narration(2),
      narration(3),
    ]);

    queue = advance(queue, NARRATION * 2 + 10);

    expect(currentEvent(queue)?.id).toBe(3);
    expect(progress(queue)).toBeCloseTo(10 / NARRATION);
  });

  it("推进完全部事件后队列停止播放", () => {
    let queue = enqueue(createEventQueue(), [narration(1), moved(2)]);

    queue = advance(queue, NARRATION + MOVED);

    expect(isPlaying(queue)).toBe(false);
    expect(currentEvent(queue)).toBeNull();
    expect(remainingMs(queue)).toBeNull();
    expect(queueLength(queue)).toBe(0);
  });

  it("推进超出总时长不会出错", () => {
    let queue = enqueue(createEventQueue(), [narration(1)]);
    queue = advance(queue, 999_999);

    expect(isPlaying(queue)).toBe(false);
    expect(advance(queue, 999_999)).toBe(queue);
  });

  it("按事件类型取用各自的时长", () => {
    let queue = enqueue(createEventQueue(), [moved(1), narration(2)]);
    expect(remainingMs(queue)).toBe(MOVED);

    queue = advance(queue, MOVED);
    expect(currentEvent(queue)?.id).toBe(2);
    expect(remainingMs(queue)).toBe(NARRATION);
  });

  it("speed 等比压缩时长", () => {
    const queue = enqueue(createEventQueue(), [narration(1)], 2);
    expect(remainingMs(queue)).toBe(Math.round(NARRATION / 2));
  });

  it("speed 为 0 或负数时退化为瞬时播放，不会卡住队列", () => {
    let queue = enqueue(createEventQueue(), [narration(1), narration(2)], 0);
    expect(remainingMs(queue)).toBe(0);

    // 零时长事件必须能被 0 毫秒的推进消费掉，否则驱动层会陷入死循环
    queue = advance(queue, 0);
    expect(isPlaying(queue)).toBe(false);
  });

  it("跳过会清空整个队列", () => {
    let queue = enqueue(createEventQueue(), [narration(1), narration(2), narration(3)]);
    queue = advance(queue, 100);
    queue = drain(queue);

    expect(isPlaying(queue)).toBe(false);
    expect(queueLength(queue)).toBe(0);
    expect(drain(queue)).toBe(queue);
  });

  it("跳过后仍然拒绝已经入过队的事件", () => {
    const batch = [narration(1), narration(2)];
    let queue = enqueue(createEventQueue(), batch);
    queue = drain(queue);
    queue = enqueue(queue, batch);

    expect(isPlaying(queue)).toBe(false);
  });

  it("事件 id 倒退时视为重开一局，丢掉旧队列", () => {
    let queue = enqueue(createEventQueue(), [narration(50), narration(51)]);
    expect(currentEvent(queue)?.id).toBe(50);

    // 重开一局后引擎的 id 从头开始
    queue = enqueue(queue, [narration(1), narration(2)]);

    expect(currentEvent(queue)?.id).toBe(1);
    expect(queueLength(queue)).toBe(2);
  });

  it("刚开局就重开，新一局的开场依然会播放", () => {
    // 引擎会让重开后的 id 接着往后排，因此水位线不会把新开局的事件误判成重复
    let state = createInitialGame(20260805);
    let queue = enqueue(createEventQueue(), state.lastEvents);
    queue = advance(queue, 999_999);
    expect(isPlaying(queue)).toBe(false);

    state = gameReducer(state, { type: "restart", seed: 4242 });
    queue = enqueue(queue, state.lastEvents);

    expect(isPlaying(queue)).toBe(true);
    expect(queueLength(queue)).toBe(state.lastEvents.length);
  });

  it("能吃下引擎真实产出的事件流", () => {
    let state = createInitialGame(20260805);
    let queue = enqueue(createEventQueue(), state.lastEvents);
    const played: number[] = [];

    for (let step = 0; step < 30 && state.phase.kind !== "gameOver"; step += 1) {
      if (state.phase.kind === "awaitingRoll") {
        state = gameReducer(state, { type: "rollMovement" });
      } else if (state.phase.kind === "turnComplete") {
        state = gameReducer(state, { type: "endTurn" });
      } else if (state.phase.kind === "battle") {
        state = resolveRound(state);
      } else {
        break;
      }
      queue = enqueue(queue, state.lastEvents);

      // 播完当前积压再继续，模拟界面等待动画结束才允许下一次操作
      while (isPlaying(queue)) {
        const event = currentEvent(queue);
        if (event) played.push(event.id);
        queue = advance(queue, remainingMs(queue)!);
      }
    }

    expect(played.length).toBeGreaterThan(20);
    // 每条事件恰好播放一次，且严格按引擎产出的顺序
    expect(new Set(played).size).toBe(played.length);
    expect([...played].sort((a, b) => a - b)).toEqual(played);
  });
});
