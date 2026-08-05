import { useState } from "react";
import { motion } from "framer-motion";
import { ROOM_CODE_LENGTH } from "./net/protocol";
import type { ConnectionStatus } from "./net/client";
import type { RoomView } from "./net/protocol";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  online: "已连接",
  offline: "连接断开，正在重试…",
};

export function ModePicker({ onLocal, onOnline }: {
  onLocal: () => void;
  onOnline: () => void;
}) {
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
        <p className="lobby-lead">两人登山竞速，先击败峰顶巨龙者获胜。</p>
        <div className="lobby-modes">
          <button className="primary-button" onClick={onOnline}>联机对战</button>
          <button className="primary-button secondary" onClick={onLocal}>本地双人</button>
        </div>
        <p className="lobby-foot">
          本地双人为同屏热座，卷轴为暗牌，轮到谁操作就只显示谁的手牌。
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
  onBack,
}: {
  status: ConnectionStatus;
  room: RoomView | null;
  error: string;
  notice: string;
  playerName: string;
  onNameChange: (name: string) => void;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
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
            <p>把这个码发给对手，等对方加入即可开始。</p>
            <div className="lobby-members">
              {room.members.map((member) => (
                <span key={member.seat} className={member.connected ? "online" : ""}>
                  {member.name}
                </span>
              ))}
              {room.members.length < 2 && <span className="pending-seat">等待对手…</span>}
            </div>
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

            <button
              className="primary-button"
              disabled={name.length === 0}
              onClick={() => onCreate(name)}
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
