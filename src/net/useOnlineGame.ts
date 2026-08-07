import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameAction } from "../game/types";
import { NetClient, loadPlayerName, type ConnectionStatus } from "./client";
import type { RoomView } from "./protocol";
import type { PlayerCount } from "./protocol";

/**
 * 把 NetClient 接到 React 上。
 *
 * 只负责连接与房间状态；对局状态直接用服务器推来的 `room.state`，
 * 它已经是按本座位裁剪过的视图，客户端不再自己跑规则引擎。
 */
export function useOnlineGame() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [playerName, setPlayerName] = useState(loadPlayerName);

  // handlers 要拿到最新的 setter，但 NetClient 只创建一次
  const handlers = useRef({ setStatus, setRoom, setError, setNotice });
  handlers.current = { setStatus, setRoom, setError, setNotice };

  const client = useMemo(
    () =>
      new NetClient({
        onStatus: (next) => handlers.current.setStatus(next),
        onRoom: (next) => {
          handlers.current.setRoom(next);
          handlers.current.setError("");
        },
        onError: (message) => handlers.current.setError(message),
        onClosed: (reason) => {
          handlers.current.setRoom(null);
          handlers.current.setNotice(reason);
        },
      }),
    [],
  );

  useEffect(() => () => client.disconnect(), [client]);

  const createRoom = useCallback(
    (name: string, capacity: PlayerCount) => {
      setNotice("");
      setPlayerName(name);
      client.createRoom(name, capacity);
    },
    [client],
  );

  const joinRoom = useCallback(
    (code: string, name: string) => {
      setNotice("");
      setPlayerName(name);
      client.joinRoom(code.trim().toUpperCase(), name);
    },
    [client],
  );

  const dispatch = useCallback((action: GameAction) => client.dispatch(action), [client]);
  const startGame = useCallback(() => client.startGame(), [client]);

  const leave = useCallback(() => {
    client.leave();
    setRoom(null);
    setNotice("");
  }, [client]);

  return {
    status,
    room,
    error,
    notice,
    playerName,
    setPlayerName,
    createRoom,
    joinRoom,
    dispatch,
    startGame,
    leave,
  };
}
