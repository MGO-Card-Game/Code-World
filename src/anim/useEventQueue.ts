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

  /*
    入队放在渲染阶段，不能放进 effect。

    引擎是原子结算的，state 一变就已经是最终值；如果等 effect 才入队，中间会多出
    一帧“状态已经到终点、队列却还是空的”。那一帧里所有按住逻辑都会短暂放开——
    血条会闪一下终值，战斗弹层甚至会先退场再重新挂上。
    enqueue 没有新事件时返回原对象，所以这里不会陷入循环。
  */
  const synced = enqueue(queue, events, speed);
  if (synced !== queue) setQueue(synced);

  /*
    依赖的是"当前事件"，不是整个队列对象。

    队列每追加一批事件都会产生新对象。依赖整个队列时 effect 会跟着重跑，cleanup 清掉
    在飞的定时器，再按整段时长重排一次——当前事件的倒计时就被推回了起点。联机时对手
    每做一个动作就是一批新事件，正在播的骰子动画会被反复顶回去，看起来就是卡着不动。
    current 没换人时本来就不需要重排，所以这里只盯它。

    effect 不重跑意味着闭包里的 `synced` 可能是旧的，这没问题：用到的
    `remainingMs(synced)` 只依赖 current 和 elapsed，而 setQueue 走的是更新函数形式，
    拿到的永远是最新队列。
  */
  useEffect(() => {
    const wait = remainingMs(synced);
    if (wait === null) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => {
      /*
        按真实流逝时间推进，而不是按排定的 wait。

        定时器只保证"不早于"：后台标签页会被节流到秒级甚至分钟级，主线程卡顿也会迟到。
        按 wait 推进的话每次迟到都是永久欠账，积压只会越积越多，切回页面时看到的就是
        一条卡住的队列；按真实时间推进，advance 会一次跨过多条积压事件把进度追回来
        （它本身就是循环消费的）。

        下限取 wait：setTimeout 与 performance.now 的取整口径不一致时，实测值可能比
        wait 小零点几毫秒。那会让 advance 走进"只累加 elapsed、不切换事件"的分支，
        current 不变、effect 不重跑，队列就真的永久停住了。
      */
      const elapsed = Math.max(wait, performance.now() - startedAt);
      setQueue((current) => advance(current, elapsed));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [synced.current]);

  const skip = useCallback(() => setQueue(drain), []);

  return {
    /** 正在播放的事件，界面据此决定播什么动画 */
    event: currentEvent(synced),
    /** 还没播到的事件。用于把对应数值按住在动画起点，见 visualState.ts */
    pending: pendingEvents(synced),
    /** 队列非空。用于在动画播放期间锁住操作按钮 */
    playing: isPlaying(synced),
    /** 当前事件的播放进度 0～1 */
    progress: progress(synced),
    /** 还剩多少条事件没播完 */
    remaining: queueLength(synced),
    skip,
  };
}
