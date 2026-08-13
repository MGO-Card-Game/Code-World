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

/**
 * 在途动作的兜底解锁时长。
 *
 * 正常情况下 roomState 或 error 一到就解锁，这个定时器不会走到。它防的是那种
 * 既没回包、也没触发 onclose 的半死连接——宁可放行一次重复提交，也不能把玩家卡死。
 */
const ACTION_TIMEOUT_MS = 5000;

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
  /** 已发出、还没等到服务器回应的动作，见 dispatch */
  private inFlightAction: string | null = null;
  private inFlightTimer: ReturnType<typeof setTimeout> | null = null;

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
          /*
            roomState 不带 requestId，认不出是哪个动作的回音，因此任何一份广播都解锁。
            别人的动作抢先解锁最坏也只是放行一次重复提交，退回到加锁之前的行为；
            反过来要求严格配对的话，一次错过就是永久卡死。
          */
          this.clearInFlight();
          this.lastJoin = {
            roomCode: message.room.code,
            playerName: this.lastJoin?.playerName ?? "",
          };
          this.handlers.onRoom(message.room);
          return;
        case "error":
          this.clearInFlight();
          this.handlers.onError(message.message);
          return;
        case "roomClosed":
          this.clearInFlight();
          this.lastJoin = null;
          this.handlers.onClosed(message.reason);
          return;
      }
    };

    socket.onclose = () => {
      this.clearInFlight();
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

  /**
   * 提交一个动作。已经有动作在途时直接丢弃这一次。
   *
   * 服务器是权威的，界面在广播回来之前不会有任何变化——从点下到收到广播这一个 RTT 里，
   * 按钮还亮着、阶段也还是原样，玩家多点的那几下会变成一模一样的第二个动作发出去。
   * 它未必会被服务器拒掉：战斗结算完 resetChoices 会把同一侧的 choice 重新置为 pending，
   * 于是「这一轮的重复提交」被当成「下一轮的提交」接受，玩家下一轮的选牌权就被无声弃掉，
   * 界面上还会因为多出来的那次广播把战斗骰点冲掉（见 anim/eventQueue 的 seen）。
   *
   * 本地热座没有这个窗口（setState 同步生效），所以这条锁只在联机时起作用。
   */
  dispatch(action: GameAction) {
    if (this.inFlightAction) return;
    const requestId = this.nextRequestId();
    if (!this.send({ type: "action", requestId, action })) return;
    this.inFlightAction = requestId;
    this.inFlightTimer = setTimeout(() => this.clearInFlight(), ACTION_TIMEOUT_MS);
  }

  /*
    解锁点要盖住所有"服务器不会再就这个动作说话了"的情形：广播（被接受）、
    error（被拒）、房间解散，以及连接断开。漏掉任何一个，锁都会一直挂着。
  */
  private clearInFlight() {
    this.inFlightAction = null;
    if (this.inFlightTimer) {
      clearTimeout(this.inFlightTimer);
      this.inFlightTimer = null;
    }
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
    this.clearInFlight();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus("idle");
  }
}
