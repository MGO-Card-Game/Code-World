import type { GameAction } from "../game/types";
import {
  decode,
  encode,
  type ClientMessage,
  type PlayerCount,
  type RoomView,
  type ServerMessage,
} from "./protocol";

/**
 * 客户端联网层。不含任何 React，便于单独推理与测试。
 *
 * 身份凭证（playerToken）存在 localStorage，与 WebSocket 连接分离——
 * 刷新页面或断线重连后凭同一 token 回到原座位，而不是变成新玩家。
 */

const TOKEN_KEY = "dicebound.playerToken";
const NAME_KEY = "dicebound.playerName";

function createPlayerToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // randomUUID 只在安全上下文（HTTPS/localhost）和较新的浏览器中可用。
  // getRandomValues 的兼容范围更广，可用于 cpolar 的临时 HTTP 入口。
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  // 极旧浏览器的最后兜底；token 只作为断线重连时的玩家标识。
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function loadPlayerToken() {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const token = createPlayerToken();
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function loadPlayerName() {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function savePlayerName(name: string) {
  localStorage.setItem(NAME_KEY, name);
}

export function serverUrl() {
  // 开发时前端在 vite（5173），服务器另起一个端口；生产是同源
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

export interface NetHandlers {
  onStatus(status: ConnectionStatus): void;
  onRoom(room: RoomView): void;
  onError(message: string): void;
  onClosed(reason: string): void;
}

export class NetClient {
  private socket: WebSocket | null = null;
  private requestSeq = 0;
  /** 断线后用它自动重进房间 */
  private lastJoin: { roomCode: string; playerName: string } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(private handlers: NetHandlers) {}

  private nextRequestId() {
    this.requestSeq += 1;
    return `r${this.requestSeq}`;
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encode(message));
      return true;
    }
    return false;
  }

  private connect(onOpen: () => void) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      onOpen();
      return;
    }
    this.manualClose = false;
    this.handlers.onStatus("connecting");
    const socket = new WebSocket(serverUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.handlers.onStatus("online");
      onOpen();
    };

    socket.onmessage = (event) => {
      const message = decode<ServerMessage>(String(event.data));
      if (!message) return;
      switch (message.type) {
        case "roomState":
          this.lastJoin = {
            roomCode: message.room.code,
            playerName: this.lastJoin?.playerName ?? "",
          };
          this.handlers.onRoom(message.room);
          return;
        case "error":
          this.handlers.onError(message.message);
          return;
        case "roomClosed":
          this.lastJoin = null;
          this.handlers.onClosed(message.reason);
          return;
      }
    };

    socket.onclose = () => {
      this.handlers.onStatus("offline");
      if (!this.manualClose && this.lastJoin) this.scheduleReconnect();
    };

    socket.onerror = () => this.handlers.onStatus("offline");
  }

  /** 断线后隔几秒自动带原 token 重进房间，位子还留着 */
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const target = this.lastJoin;
      if (!target) return;
      this.connect(() => {
        this.send({
          type: "joinRoom",
          requestId: this.nextRequestId(),
          roomCode: target.roomCode,
          playerName: target.playerName,
          playerToken: loadPlayerToken(),
        });
      });
    }, 2000);
  }

  createRoom(playerName: string, capacity: PlayerCount) {
    savePlayerName(playerName);
    this.lastJoin = null;
    this.connect(() => {
      this.send({
        type: "createRoom",
        requestId: this.nextRequestId(),
        playerName,
        playerToken: loadPlayerToken(),
        capacity,
      });
    });
  }

  joinRoom(roomCode: string, playerName: string) {
    savePlayerName(playerName);
    this.lastJoin = { roomCode, playerName };
    this.connect(() => {
      this.send({
        type: "joinRoom",
        requestId: this.nextRequestId(),
        roomCode,
        playerName,
        playerToken: loadPlayerToken(),
      });
    });
  }

  dispatch(action: GameAction) {
    this.send({ type: "action", requestId: this.nextRequestId(), action });
  }

  startGame() {
    this.send({ type: "startGame", requestId: this.nextRequestId() });
  }

  leave() {
    this.send({ type: "leaveRoom", requestId: this.nextRequestId() });
    this.disconnect();
  }

  disconnect() {
    this.manualClose = true;
    this.lastJoin = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus("idle");
  }
}
