import type { GameAction, GameStateView, PlayerId } from "../game/types";

/**
 * 客户端与服务器之间的消息协议。
 *
 * 放在 src/ 下是为了两端 import 同一份定义：客户端直接引，
 * 服务器用相对路径引（server/ 与 src/ 同属一个 tsconfig 之外的编译单元，
 * 但类型来源必须是同一个文件，否则协议会悄悄漂移）。
 */

/** 房间码字符集：去掉 I / O / 0 / 1 等易混字符，避免玩家口头传码时出错 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export type RoomStatus = "waiting" | "playing";

export interface RoomMember {
  seat: PlayerId;
  name: string;
  connected: boolean;
}

/** 服务器推给某一位玩家的房间视图 */
export interface RoomView {
  code: string;
  status: RoomStatus;
  /** 你坐在哪个位置 */
  seat: PlayerId;
  members: RoomMember[];
  /** 已按接收方裁剪过的对局状态；两人到齐前为 null */
  state: GameStateView | null;
}

export type ClientMessage =
  | { type: "createRoom"; requestId: string; playerName: string; playerToken: string }
  | {
      type: "joinRoom";
      requestId: string;
      roomCode: string;
      playerName: string;
      playerToken: string;
    }
  | { type: "leaveRoom"; requestId: string }
  | { type: "action"; requestId: string; action: GameAction };

export type ServerMessage =
  | { type: "ack"; requestId: string; roomCode: string; seat: PlayerId }
  | { type: "error"; requestId?: string; message: string }
  | { type: "roomState"; room: RoomView }
  /** 对手离开且房间已解散 */
  | { type: "roomClosed"; reason: string };

export function encode(message: ServerMessage | ClientMessage) {
  return JSON.stringify(message);
}

export function decode<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
