import { randomInt } from "node:crypto";
import { createInitialGame, gameReducer } from "../src/game/engine";
import { canAct, viewFor } from "../src/game/multiplayer";
import type { GameAction, GameState, PlayerId } from "../src/game/types";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomView,
  type ServerMessage,
} from "../src/net/protocol";

/**
 * 房间注册表。
 *
 * 刻意不依赖 WebSocket——只依赖 Connection 这个只有 send/close 的接口，
 * 因此整套房间逻辑（建房、入座、重连、授权、裁剪广播、回收）都能脱离网络单元测试。
 */

export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

interface Seat {
  seat: PlayerId;
  name: string;
  token: string;
  connection: Connection | null;
  connected: boolean;
}

interface Room {
  code: string;
  seats: Seat[];
  /** 两人到齐后才创建，此前为 null（status: waiting） */
  state: GameState | null;
  lastActivity: number;
}

export interface JoinResult {
  ok: true;
  roomCode: string;
  seat: PlayerId;
}

export interface FailResult {
  ok: false;
  message: string;
}

export type ActionOutcome = { ok: true } | FailResult;

const SEATS: PlayerId[] = ["player1", "player2"];
const MAX_NAME_LENGTH = 16;
/** 全员掉线超过这个时长的房间会被回收 */
export const ROOM_TTL_MS = 10 * 60 * 1000;

function sanitizeName(raw: string, fallback: string) {
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : fallback;
}

export class RoomStore {
  private rooms = new Map<string, Room>();
  /** 反查：一条连接坐在哪个房间的哪个位子 */
  private bySocket = new Map<Connection, { code: string; token: string }>();

  constructor(private now: () => number = Date.now) {}

  private generateCode() {
    // 碰撞就重来。5 位 32 进制约 3355 万组合，实际几乎不会撞
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("房间码空间耗尽");
  }

  createRoom(
    connection: Connection,
    playerName: string,
    playerToken: string,
  ): JoinResult | FailResult {
    if (!playerToken) return { ok: false, message: "缺少身份凭证" };
    this.detach(connection);

    const code = this.generateCode();
    const room: Room = {
      code,
      seats: [
        {
          seat: "player1",
          name: sanitizeName(playerName, "赤焰旅者"),
          token: playerToken,
          connection,
          connected: true,
        },
      ],
      state: null,
      lastActivity: this.now(),
    };
    this.rooms.set(code, room);
    this.bySocket.set(connection, { code, token: playerToken });
    this.broadcast(room);
    return { ok: true, roomCode: code, seat: "player1" };
  }

  joinRoom(
    connection: Connection,
    roomCode: string,
    playerName: string,
    playerToken: string,
  ): JoinResult | FailResult {
    if (!playerToken) return { ok: false, message: "缺少身份凭证" };
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return { ok: false, message: "房间不存在" };

    this.detach(connection);
    room.lastActivity = this.now();

    // 先按 token 找老位子——这是重连，不是新玩家
    const existing = room.seats.find((seat) => seat.token === playerToken);
    if (existing) {
      existing.connection?.close();
      existing.connection = connection;
      existing.connected = true;
      existing.name = sanitizeName(playerName, existing.name);
      this.bySocket.set(connection, { code, token: playerToken });
      this.broadcast(room);
      return { ok: true, roomCode: code, seat: existing.seat };
    }

    if (room.seats.length >= SEATS.length) {
      return { ok: false, message: "房间已满" };
    }

    const seat = SEATS[room.seats.length];
    room.seats.push({
      seat,
      name: sanitizeName(playerName, "苍潮旅者"),
      token: playerToken,
      connection,
      connected: true,
    });
    this.bySocket.set(connection, { code, token: playerToken });

    // 两人到齐即开局。种子由服务器定，客户端无法反复重开挑开局
    if (room.seats.length === SEATS.length && !room.state) {
      room.state = createInitialGame();
    }
    this.broadcast(room);
    return { ok: true, roomCode: code, seat };
  }

  applyAction(connection: Connection, action: GameAction): ActionOutcome {
    const located = this.locate(connection);
    if (!located) return { ok: false, message: "尚未加入房间" };
    const { room, seat } = located;
    if (!room.state) return { ok: false, message: "对局尚未开始" };

    // canAct 只管授权：阶段对不对、是不是他那一侧、是不是已经提交过
    if (!canAct(room.state, action, seat.seat)) {
      return { ok: false, message: "现在还轮不到你做这个操作" };
    }

    // 合法性由引擎判断。动作没被接受时 gameReducer 原样返回传入的对象，
    // 这里据此回一条错误，而不是广播一个跟原来一模一样的状态让客户端干等
    const next = gameReducer(room.state, action);
    if (next === room.state) {
      return { ok: false, message: "这个操作现在不合法" };
    }

    room.state = next;
    room.lastActivity = this.now();
    this.broadcast(room);
    return { ok: true };
  }

  /**
   * 主动离开：房间对双方一起关闭。
   *
   * 与「掉线」区别对待——掉线只标记离线并保留位子等重连，
   * 主动退出则说明这局不打了，留着半个房间没有意义。
   */
  leave(connection: Connection) {
    const located = this.locate(connection);
    if (!located) return;
    this.closeRoom(located.room, "对手已离开房间");
  }

  /** 网络断开：保留位子，等待带同一 token 重连 */
  disconnect(connection: Connection) {
    const located = this.locate(connection);
    this.bySocket.delete(connection);
    if (!located) return;
    const { room, seat } = located;
    if (seat.connection !== connection) return;
    seat.connection = null;
    seat.connected = false;
    room.lastActivity = this.now();
    this.broadcast(room);
  }

  /** 回收全员掉线且超时的房间。由服务器定时调用 */
  sweep(ttlMs = ROOM_TTL_MS) {
    const deadline = this.now() - ttlMs;
    for (const room of [...this.rooms.values()]) {
      const anyoneOnline = room.seats.some((seat) => seat.connected);
      if (anyoneOnline) continue;
      if (room.lastActivity > deadline) continue;
      this.closeRoom(room, "房间因长时间无人而关闭");
    }
  }

  get size() {
    return this.rooms.size;
  }

  /** 仅供测试与运维检查 */
  peek(code: string) {
    return this.rooms.get(code);
  }

  private closeRoom(room: Room, reason: string) {
    for (const seat of room.seats) {
      if (seat.connection) {
        seat.connection.send({ type: "roomClosed", reason });
        this.bySocket.delete(seat.connection);
      }
    }
    this.rooms.delete(room.code);
  }

  private detach(connection: Connection) {
    const located = this.locate(connection);
    if (!located) return;
    if (located.seat.connection === connection) {
      located.seat.connection = null;
      located.seat.connected = false;
    }
    this.bySocket.delete(connection);
  }

  private locate(connection: Connection) {
    const ref = this.bySocket.get(connection);
    if (!ref) return null;
    const room = this.rooms.get(ref.code);
    if (!room) return null;
    const seat = room.seats.find((item) => item.token === ref.token);
    if (!seat) return null;
    return { room, seat };
  }

  private viewOf(room: Room, seat: Seat): RoomView {
    return {
      code: room.code,
      status: room.state ? "playing" : "waiting",
      seat: seat.seat,
      members: room.seats.map((item) => ({
        seat: item.seat,
        name: item.name,
        connected: item.connected,
      })),
      // 每个人拿到的是按自己裁剪过的状态，不是同一份
      state: room.state ? viewFor(room.state, seat.seat) : null,
    };
  }

  private broadcast(room: Room) {
    for (const seat of room.seats) {
      seat.connection?.send({ type: "roomState", room: this.viewOf(room, seat) });
    }
  }
}
