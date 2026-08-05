import { useCallback, useEffect, useState } from "react";
import type { GameEvent } from "../game/types";
import {
  advance,
  createEventQueue,
  currentEvent,
  drain,
  enqueue,
  isPlaying,
  pendingEvents,
  progress,
  queueLength,
  remainingMs,
} from "./eventQueue";

/**
 * 把引擎吐出的事件流接到时间轴上。
 *
 * 传入 `state.lastEvents` 即可——队列按事件 id 去重，
 * 组件重渲染不会让同一条动画播两遍。
 *
 * 这里用 setTimeout 而不是 requestAnimationFrame：界面只需要知道
 * “现在轮到哪条事件”，逐帧的补间交给 CSS / 动画库在 React 之外做，
 * 这样一条事件只触发一次重渲染，而不是每秒六十次。
 */
export function useEventQueue(events: readonly GameEvent[], speed = 1) {
  const [queue, setQueue] = useState(createEventQueue);

  useEffect(() => {
    setQueue((current) => enqueue(current, events, speed));
  }, [events, speed]);

  useEffect(() => {
    const wait = remainingMs(queue);
    if (wait === null) return;
    const timer = window.setTimeout(() => {
      setQueue((current) => advance(current, wait));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [queue]);

  const skip = useCallback(() => setQueue(drain), []);

  return {
    /** 正在播放的事件，界面据此决定播什么动画 */
    event: currentEvent(queue),
    /** 还没播到的事件。用于把对应数值按住在动画起点，见 visualState.ts */
    pending: pendingEvents(queue),
    /** 队列非空。用于在动画播放期间锁住操作按钮 */
    playing: isPlaying(queue),
    /** 当前事件的播放进度 0～1 */
    progress: progress(queue),
    /** 还剩多少条事件没播完 */
    remaining: queueLength(queue),
    skip,
  };
}
