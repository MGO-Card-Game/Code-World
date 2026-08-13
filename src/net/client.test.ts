import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetClient } from "./client";
import { encode, type ClientMessage, type ServerMessage } from "./protocol";
import type { RoomView } from "./protocol";

/**
 * 联网层里唯一有状态的那部分：动作在途锁。
 *
 * 服务器是权威的，界面在广播回来之前不会有任何变化——从点下到收到广播这一个 RTT 里，
 * 按钮还亮着，玩家多点的那几下会变成一模一样的第二个动作发出去。它未必会被拒：
 * 战斗结算完 resetChoices 会把同一侧的 choice 重新置为 pending，重复提交就被当成
 * 下一轮的提交接受了。所以重复的那一下必须在客户端就拦下来。
 *
 * 锁的风险全在"解不开"那一侧：漏掉任何一个解锁点，界面就永久失去响应，
 * 比原来的重复提交更糟。下面每个解锁点都各有一条用例。
 */

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  /** 服务器发来一条消息 */
  deliver(message: ServerMessage) {
    this.onmessage?.({ data: encode(message) });
  }

  /** 这条连接上发出去的动作帧 */
  actions() {
    return this.sent
      .map((raw) => JSON.parse(raw) as ClientMessage)
      .filter((message) => message.type === "action");
  }

  static last() {
    return FakeSocket.instances.at(-1)!;
  }
}

function roomState(): ServerMessage {
  const room: RoomView = {
    code: "ABCDE",
    status: "playing",
    seat: "player1",
    hostSeat: "player1",
    capacity: 2,
    members: [],
    state: null,
  };
  return { type: "roomState", room };
}

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

/** 连上、进房、握手完成，返回可以直接发动作的客户端 */
function connected() {
  const client = new NetClient({
    onStatus: () => {},
    onRoom: () => {},
    onError: () => {},
    onClosed: () => {},
  });
  client.joinRoom("ABCDE", "赤焰旅者");
  FakeSocket.last().onopen?.();
  return { client, socket: FakeSocket.last() };
}

describe("动作在途锁", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("location", { hostname: "localhost", protocol: "http:", host: "localhost" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("同一个动作连点两下只发出一次", () => {
    const { client, socket } = connected();

    client.dispatch({ type: "rollMovement" });
    client.dispatch({ type: "rollMovement" });
    client.dispatch({ type: "rollMovement" });

    expect(socket.actions()).toHaveLength(1);
  });

  it("广播回来就解锁，下一个动作照常发出", () => {
    const { client, socket } = connected();

    client.dispatch({ type: "rollMovement" });
    socket.deliver(roomState());
    client.dispatch({ type: "endTurn" });

    expect(socket.actions().map((message) => message.action.type)).toEqual([
      "rollMovement",
      "endTurn",
    ]);
  });

  it("被服务器拒掉也解锁，不会卡住后续操作", () => {
    const { client, socket } = connected();

    client.dispatch({ type: "rollMovement" });
    socket.deliver({ type: "error", requestId: "r2", message: "这个操作现在不合法" });
    client.dispatch({ type: "rollMovement" });

    expect(socket.actions()).toHaveLength(2);
  });

  it("连接断掉再重连后仍然能操作", () => {
    /*
      掉线时锁若不解，自动重连回来的玩家会发现自己永远点不动——
      比重复提交严重得多，所以 onclose 也是解锁点。
    */
    const { client, socket } = connected();
    client.dispatch({ type: "rollMovement" });
    expect(socket.actions()).toHaveLength(1);

    socket.close();
    vi.advanceTimersByTime(2000); // 自动重连
    const reconnected = FakeSocket.last();
    expect(reconnected).not.toBe(socket);
    reconnected.onopen?.();

    client.dispatch({ type: "rollMovement" });
    expect(reconnected.actions()).toHaveLength(1);
  });

  it("服务器久久不回话时兜底解锁", () => {
    // 既没回包也没触发 onclose 的半死连接：宁可放行一次重复提交，也不能把玩家卡死
    const { client, socket } = connected();

    client.dispatch({ type: "rollMovement" });
    expect(socket.actions()).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    client.dispatch({ type: "rollMovement" });

    expect(socket.actions()).toHaveLength(2);
  });

  it("连接没开时不上锁，重连后第一个动作仍发得出去", () => {
    const client = new NetClient({
      onStatus: () => {},
      onRoom: () => {},
      onError: () => {},
      onClosed: () => {},
    });
    client.joinRoom("ABCDE", "赤焰旅者");
    const socket = FakeSocket.last();
    socket.readyState = FakeSocket.CLOSED;

    client.dispatch({ type: "rollMovement" }); // 发不出去，也不该占住锁
    socket.readyState = FakeSocket.OPEN;
    client.dispatch({ type: "rollMovement" });

    expect(socket.actions()).toHaveLength(1);
  });
});
