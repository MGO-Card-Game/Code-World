import { useState } from "react";
import { motion } from "framer-motion";
import { ROOM_CODE_LENGTH } from "./net/protocol";
import type { ConnectionStatus } from "./net/client";
import type { PlayerCount, RoomView } from "./net/protocol";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  online: "已连接",
  offline: "连接断开，正在重试…",
};

export function ModePicker({ onLocal, onOnline }: {
  onLocal: (count: PlayerCount) => void;
  onOnline: () => void;
}) {
  const [localCount, setLocalCount] = useState<PlayerCount>(2);
  return (
    <main className="app-shell lobby-shell">
      <motion.section
        className="lobby-card"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        <div className="brand lobby-brand">
          <span className="brand-mark">D/S</span>
          <div><span>Dicebound Summit</span><h1>骰境登峰</h1></div>
        </div>
        <p className="lobby-lead">2–4 人登山竞速，先击败峰顶巨龙者获胜。</p>
        <div className="lobby-modes">
          <button className="primary-button" onClick={onOnline}>联机对战</button>
          <div className="local-mode-row">
            <select
              aria-label="本地游戏人数"
              value={localCount}
              onChange={(event) => setLocalCount(Number(event.target.value) as PlayerCount)}
            >
              <option value={2}>2 人</option>
              <option value={3}>3 人</option>
              <option value={4}>4 人</option>
            </select>
            <button className="primary-button secondary" onClick={() => onLocal(localCount)}>本地热座</button>
          </div>
        </div>
        <p className="lobby-foot">
          本地模式为同屏热座，卷轴为暗牌，轮到谁操作就只显示谁的手牌。
        </p>
      </motion.section>
    </main>
  );
}

export function RoomLobby({
  status,
  room,
  error,
  notice,
  playerName,
  onNameChange,
  onCreate,
  onJoin,
  onStart,
  onBack,
}: {
  status: ConnectionStatus;
  room: RoomView | null;
  error: string;
  notice: string;
  playerName: string;
  onNameChange: (name: string) => void;
  onCreate: (name: string, capacity: PlayerCount) => void;
  onJoin: (code: string, name: string) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState<PlayerCount>(4);
  const name = playerName.trim();
  const waiting = room?.status === "waiting";

  return (
    <main className="app-shell lobby-shell">
      <motion.section
        className="lobby-card"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        <div className="brand lobby-brand">
          <span className="brand-mark">D/S</span>
          <div><span>Dicebound Summit</span><h1>联机对战</h1></div>
        </div>

        <div className={`lobby-status status-${status}`}>{STATUS_TEXT[status]}</div>
        {notice && <p className="lobby-notice">{notice}</p>}
        {error && <p className="lobby-error">{error}</p>}

        {waiting && room ? (
          <div className="lobby-waiting">
            <span className="eyebrow">房间码</span>
            <strong className="room-code">{room.code}</strong>
            <p>把房间码发给其他玩家；2–{room.capacity} 人均可由房主开始。</p>
            <div className="lobby-members">
              {room.members.map((member) => (
                <span key={member.seat} className={member.connected ? "online" : ""}>
                  {member.name}{member.seat === room.hostSeat ? " · 房主" : ""}
                </span>
              ))}
              {Array.from({ length: room.capacity - room.members.length }, (_, index) => (
                <span className="pending-seat" key={`pending-${index}`}>等待玩家…</span>
              ))}
            </div>
            {room.seat === room.hostSeat ? (
              <button
                className="primary-button"
                disabled={room.members.length < 2 || room.members.some((member) => !member.connected)}
                onClick={onStart}
              >
                开始 {room.members.length} 人游戏
              </button>
            ) : (
              <p className="waiting-notice">等待房主开始游戏…</p>
            )}
            <button className="ghost-button" onClick={onBack}>离开房间</button>
          </div>
        ) : (
          <>
            <label className="lobby-field">
              你的名字
              <input
                value={playerName}
                maxLength={16}
                placeholder="旅者"
                onChange={(event) => onNameChange(event.target.value)}
              />
            </label>

            <label className="lobby-field">
              房间上限
              <select
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value) as PlayerCount)}
              >
                <option value={2}>2 人</option>
                <option value={3}>3 人</option>
                <option value={4}>4 人</option>
              </select>
            </label>

            <button
              className="primary-button"
              disabled={name.length === 0}
              onClick={() => onCreate(name, capacity)}
            >
              创建房间
            </button>

            <div className="lobby-divider"><span>或</span></div>

            <label className="lobby-field">
              房间码
              <input
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                placeholder={"A".repeat(ROOM_CODE_LENGTH)}
                spellCheck={false}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
            <button
              className="primary-button secondary"
              disabled={name.length === 0 || code.trim().length !== ROOM_CODE_LENGTH}
              onClick={() => onJoin(code, name)}
            >
              加入房间
            </button>

            <button className="ghost-button lobby-back" onClick={onBack}>返回</button>
          </>
        )}
      </motion.section>
    </main>
  );
}
