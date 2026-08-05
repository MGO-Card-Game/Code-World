import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type ServerMessage } from "../src/net/protocol";
import { isHiddenScroll } from "../src/game/multiplayer";
import { RoomStore, type Connection } from "./roomStore";

class FakeConnection implements Connection {
  sent: ServerMessage[] = [];
  closed = false;

  send(message: ServerMessage) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
  }

  /** 最近一次收到的房间状态 */
  lastRoom() {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const message = this.sent[index];
      if (message.type === "roomState") return message.room;
    }
    return null;
  }

  lastOf(type: ServerMessage["type"]) {
    return [...this.sent].reverse().find((message) => message.type === type) ?? null;
  }
}

/** 建一个两人已入座、对局已开始的房间 */
function seatedRoom() {
  const store = new RoomStore();
  const host = new FakeConnection();
  const guest = new FakeConnection();
  const created = store.createRoom(host, "赤焰", "token-host");
  if (!created.ok) throw new Error(created.message);
  const joined = store.joinRoom(guest, created.roomCode, "苍潮", "token-guest");
  if (!joined.ok) throw new Error(joined.message);
  return { store, host, guest, code: created.roomCode };
}

describe("房间码", () => {
  it("长度与字符集符合约定，且不含易混字符", () => {
    const store = new RoomStore();
    const codes = new Set<string>();

    for (let index = 0; index < 200; index += 1) {
      const created = store.createRoom(new FakeConnection(), "旅者", `token-${index}`);
      if (!created.ok) throw new Error(created.message);
      expect(created.roomCode).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of created.roomCode) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
      expect("IO01").not.toContain(created.roomCode[0]);
      codes.add(created.roomCode);
    }

    // 200 个房间不该撞码
    expect(codes.size).toBe(200);
    expect(store.size).toBe(200);
  });

  it("入房码不区分大小写、容忍空格", () => {
    const store = new RoomStore();
    const host = new FakeConnection();
    const created = store.createRoom(host, "赤焰", "token-host");
    if (!created.ok) throw new Error(created.message);

    const joined = store.joinRoom(
      new FakeConnection(),
      ` ${created.roomCode.toLowerCase()} `,
      "苍潮",
      "token-guest",
    );
    expect(joined.ok).toBe(true);
  });
});

describe("入座与开局", () => {
  it("房主坐 player1，第二人坐 player2", () => {
    const { host, guest } = seatedRoom();
    expect(host.lastRoom()?.seat).toBe("player1");
    expect(guest.lastRoom()?.seat).toBe("player2");
  });

  it("只有一个人时是等待状态，没有对局", () => {
    const store = new RoomStore();
    const host = new FakeConnection();
    store.createRoom(host, "赤焰", "token-host");

    expect(host.lastRoom()?.status).toBe("waiting");
    expect(host.lastRoom()?.state).toBeNull();
  });

  it("两人到齐即开局，双方都收到状态", () => {
    const { host, guest } = seatedRoom();

    expect(host.lastRoom()?.status).toBe("playing");
    expect(host.lastRoom()?.state).not.toBeNull();
    expect(guest.lastRoom()?.state).not.toBeNull();
  });

  it("第三个人被拒绝", () => {
    const { store, code } = seatedRoom();
    const third = store.joinRoom(new FakeConnection(), code, "第三者", "token-third");

    expect(third).toEqual({ ok: false, message: "房间已满" });
  });

  it("房间不存在时给出明确错误", () => {
    const store = new RoomStore();
    expect(store.joinRoom(new FakeConnection(), "ZZZZZ", "旅者", "token")).toEqual({
      ok: false,
      message: "房间不存在",
    });
  });
});

describe("按座位裁剪广播", () => {
  it("两人收到的不是同一份状态，各自只看得见自己的手牌", () => {
    const { store, host, guest, code } = seatedRoom();
    const room = store.peek(code);
    if (!room?.state) throw new Error("对局应该已经开始");

    room.state.players.player1.scrolls = [{ instanceId: "s1", kind: "might" }];
    room.state.players.player2.scrolls = [{ instanceId: "s2", kind: "guard" }];
    // 触发一次广播
    store.applyAction(host, { type: "restart" });
    room.state = store.peek(code)!.state!;
    room.state.players.player1.scrolls = [{ instanceId: "s1", kind: "might" }];
    room.state.players.player2.scrolls = [{ instanceId: "s2", kind: "guard" }];
    store.disconnect(guest); // 任意一次会触发广播的操作

    const hostView = host.lastRoom()?.state;
    const guestSeat = "player2" as const;
    if (!hostView) throw new Error("房主应当收到状态");

    // 房主看得见自己的、看不见对手的
    expect(isHiddenScroll(hostView.players.player1.scrolls[0])).toBe(false);
    expect(isHiddenScroll(hostView.players[guestSeat].scrolls[0])).toBe(true);
  });
});

describe("动作授权", () => {
  it("轮不到的人操作会被拒绝，且不改变状态", () => {
    const { store, host, guest, code } = seatedRoom();
    const state = store.peek(code)?.state;
    if (!state) throw new Error("对局应该已经开始");

    const idle = state.activePlayerId === "player1" ? guest : host;
    const active = state.activePlayerId === "player1" ? host : guest;

    const rejected = store.applyAction(idle, { type: "rollMovement" });
    expect(rejected.ok).toBe(false);
    expect(store.peek(code)?.state?.turn).toBe(state.turn);

    const accepted = store.applyAction(active, { type: "rollMovement" });
    expect(accepted.ok).toBe(true);
  });

  it("未入座的连接不能操作", () => {
    const { store } = seatedRoom();
    const stranger = new FakeConnection();

    expect(store.applyAction(stranger, { type: "rollMovement" })).toEqual({
      ok: false,
      message: "尚未加入房间",
    });
  });

  it("只有一个人时不能开打", () => {
    const store = new RoomStore();
    const host = new FakeConnection();
    store.createRoom(host, "赤焰", "token-host");

    expect(store.applyAction(host, { type: "rollMovement" })).toEqual({
      ok: false,
      message: "对局尚未开始",
    });
  });
});

describe("掉线与重连", () => {
  it("掉线只标记离线，位子保留", () => {
    const { store, host, guest, code } = seatedRoom();
    store.disconnect(guest);

    const members = host.lastRoom()?.members;
    expect(members?.find((m) => m.seat === "player2")?.connected).toBe(false);
    // 房间和对局都还在
    expect(store.peek(code)?.state).not.toBeNull();
  });

  it("带同一 token 重连回到原座位，且对局延续", () => {
    const { store, guest, code } = seatedRoom();
    const before = store.peek(code)?.state?.rngSeed;
    store.disconnect(guest);

    const reconnected = new FakeConnection();
    const result = store.joinRoom(reconnected, code, "苍潮", "token-guest");

    expect(result).toEqual({ ok: true, roomCode: code, seat: "player2" });
    expect(reconnected.lastRoom()?.state).not.toBeNull();
    // 不是新开一局
    expect(store.peek(code)?.state?.rngSeed).toBe(before);
  });

  it("换一个 token 重连会被当成新玩家而挤不进去", () => {
    const { store, guest, code } = seatedRoom();
    store.disconnect(guest);

    const impostor = store.joinRoom(new FakeConnection(), code, "冒充者", "token-other");
    expect(impostor).toEqual({ ok: false, message: "房间已满" });
  });

  it("同一 token 二次连接时，旧连接被关掉", () => {
    const { store, guest, code } = seatedRoom();
    const replacement = new FakeConnection();

    store.joinRoom(replacement, code, "苍潮", "token-guest");

    expect(guest.closed).toBe(true);
    expect(replacement.lastRoom()?.seat).toBe("player2");
  });
});

describe("离开与回收", () => {
  it("主动离开会关闭整个房间并通知对手", () => {
    const { store, host, guest, code } = seatedRoom();
    store.leave(guest);

    expect(store.peek(code)).toBeUndefined();
    expect(host.lastOf("roomClosed")).toEqual({
      type: "roomClosed",
      reason: "对手已离开房间",
    });
  });

  it("全员掉线且超时的房间被回收", () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const host = new FakeConnection();
    const guest = new FakeConnection();
    const created = store.createRoom(host, "赤焰", "token-host");
    if (!created.ok) throw new Error(created.message);
    store.joinRoom(guest, created.roomCode, "苍潮", "token-guest");

    store.disconnect(host);
    store.disconnect(guest);

    // 还没到期
    clock += 5 * 60 * 1000;
    store.sweep();
    expect(store.peek(created.roomCode)).toBeDefined();

    // 超过 TTL
    clock += 6 * 60 * 1000;
    store.sweep();
    expect(store.peek(created.roomCode)).toBeUndefined();
  });

  it("还有人在线的房间不会被回收", () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const host = new FakeConnection();
    const created = store.createRoom(host, "赤焰", "token-host");
    if (!created.ok) throw new Error(created.message);

    clock += 60 * 60 * 1000;
    store.sweep();

    expect(store.peek(created.roomCode)).toBeDefined();
  });
});
