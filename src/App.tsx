import { useCallback, useMemo, useState } from "react";
import { DebugPanel } from "./DebugPanel";
import { GameScreen } from "./GameScreen";
import { ModePicker, RoomLobby } from "./Lobby";
import { createInitialGame, gameReducer, PLAYER_IDS } from "./game/engine";
import { currentActor, viewFor } from "./game/multiplayer";
import type { GameAction } from "./game/types";
import type { PlayerCount } from "./net/protocol";
import { useOnlineGame } from "./net/useOnlineGame";

type Mode = "menu" | "local" | "online";

/**
 * 本地热座。
 *
 * 卷轴是暗牌，所以屏幕上只能显示"此刻该操作的人"的手牌——
 * viewerSeat 取 currentActor 而不是 activePlayerId，因为战斗中防守方也要选牌、
 * 相遇战代价由败方来付，两者都不是当前行动方。
 *
 * 这样本地与联机走的是同一套界面：差别只在状态从哪来、观看者是谁。
 */
function LocalGame({ onExit, playerCount }: { onExit: () => void; playerCount: PlayerCount }) {
  // 用 useState 而不是 useReducer：调试面板需要直接替换状态，
  // 这样调试改动就不必做成 GameAction，也就不可能被发到服务器
  const [state, setState] = useState(() =>
    createInitialGame(undefined, {}, PLAYER_IDS.slice(0, playerCount)),
  );
  const dispatch = useCallback(
    (action: GameAction) => setState((current) => gameReducer(current, action)),
    [],
  );
  const viewerSeat = currentActor(state);
  const view = useMemo(() => viewFor(state, viewerSeat), [state, viewerSeat]);

  return (
    <>
      <GameScreen
        state={view}
        viewerSeat={viewerSeat}
        dispatch={dispatch}
        toolbar={
          <div className="topbar-actions">
            <button className="ghost-button topbar-system-button" onClick={() => dispatch({ type: "restart" })}>
              重新开局
            </button>
            <button className="ghost-button topbar-system-button" onClick={onExit}>返回菜单</button>
          </div>
        }
      />
      {import.meta.env.DEV && <DebugPanel state={state} onChange={setState} />}
    </>
  );
}

function OnlineGame({ onExit }: { onExit: () => void }) {
  const net = useOnlineGame();

  if (net.room?.status === "playing" && net.room.state) {
    return (
      <GameScreen
        state={net.room.state}
        viewerSeat={net.room.seat}
        dispatch={net.dispatch}
        canRestart={net.room.seat === net.room.hostSeat}
        toolbar={
          <div className="topbar-actions">
            <span className="room-tag">房间 {net.room.code}</span>
            {net.error && <span className="topbar-error">{net.error}</span>}
            <button
              className="ghost-button topbar-system-button"
              onClick={() => {
                net.leave();
                onExit();
              }}
            >
              离开房间
            </button>
          </div>
        }
      />
    );
  }

  return (
    <RoomLobby
      status={net.status}
      room={net.room}
      error={net.error}
      notice={net.notice}
      playerName={net.playerName}
      onNameChange={net.setPlayerName}
      onCreate={net.createRoom}
      onJoin={net.joinRoom}
      onStart={net.startGame}
      onBack={() => {
        net.leave();
        onExit();
      }}
    />
  );
}

export function App() {
  const [mode, setMode] = useState<Mode>("menu");
  const [localPlayerCount, setLocalPlayerCount] = useState<PlayerCount>(2);

  if (mode === "local") return <LocalGame playerCount={localPlayerCount} onExit={() => setMode("menu")} />;
  if (mode === "online") return <OnlineGame onExit={() => setMode("menu")} />;
  return (
    <ModePicker
      onLocal={(count) => {
        setLocalPlayerCount(count);
        setMode("local");
      }}
      onOnline={() => setMode("online")}
    />
  );
}
