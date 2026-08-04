import { useEffect, useReducer, useState } from "react";
import { EQUIPMENT, SCROLLS, TILE_ICON } from "./game/content";
import {
  createInitialGame,
  gameReducer,
  getBattleParticipants,
  getSidePlayer,
  MAP,
  PLAYER_IDS,
} from "./game/engine";
import { getAttack, getDefense } from "./game/selectors";
import type { BattleState, GameState, Player, PlayerId } from "./game/types";

const tileClassNames = {
  start: "start",
  battle: "battle",
  treasure: "treasure",
  spring: "spring",
  event: "event",
  boss: "boss",
};

function HealthBar({ value, max }: { value: number; max: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="health-track" aria-label={`生命 ${value}/${max}`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function PlayerPanel({ player, active }: { player: Player; active: boolean }) {
  return (
    <aside className={`player-panel ${active ? "active" : ""}`} style={{ "--player-color": player.color } as React.CSSProperties}>
      <div className="player-heading">
        <span className="player-sigil">{player.id === "player1" ? "焰" : "潮"}</span>
        <div>
          <span className="eyebrow">{active ? "当前行动" : "登山者"}</span>
          <h2>{player.name}</h2>
        </div>
      </div>
      <div className="hp-row">
        <span>生命</span><strong>{player.hp}/{player.maxHp}</strong>
      </div>
      <HealthBar value={player.hp} max={player.maxHp} />
      <div className="stat-grid">
        <div><span>攻击</span><strong>{getAttack(player)}</strong></div>
        <div><span>防御</span><strong>{getDefense(player)}</strong></div>
        <div><span>进度</span><strong>{player.position}/17</strong></div>
      </div>
      <div className="inventory-block">
        <h3>卷轴 <span>{player.scrolls.length}</span></h3>
        <div className="chips">
          {player.scrolls.length === 0 && <em>尚未获得</em>}
          {player.scrolls.map((scroll) => (
            <span className={`chip scroll-${scroll.kind}`} key={scroll.instanceId}>
              {SCROLLS[scroll.kind].name}
            </span>
          ))}
        </div>
      </div>
      <div className="inventory-block">
        <h3>装备 <span>{player.equipment.length}</span></h3>
        <div className="chips">
          {player.equipment.length === 0 && <em>尚未获得</em>}
          {player.equipment.map((item) => (
            <span className="chip equipment" key={item.instanceId}>{EQUIPMENT[item.kind].name}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Board({ state }: { state: GameState }) {
  return (
    <section className="board-shell">
      <div className="mountain-glow" />
      <div className="board" aria-label="登山棋盘">
        {MAP.map((tile) => {
          const rowFromBottom = Math.floor(tile.id / 6);
          const rawColumn = tile.id % 6;
          const column = rowFromBottom % 2 === 0 ? rawColumn + 1 : 6 - rawColumn;
          const row = 3 - rowFromBottom;
          const playersHere = PLAYER_IDS.filter((id) => state.players[id].position === tile.id);
          return (
            <article
              className={`tile ${tileClassNames[tile.type]} ${state.players[state.activePlayerId].position === tile.id ? "current" : ""}`}
              style={{ gridColumn: column, gridRow: row }}
              key={tile.id}
            >
              <span className="tile-number">{String(tile.id).padStart(2, "0")}</span>
              <span className="tile-icon">{TILE_ICON[tile.type]}</span>
              <strong>{tile.label}</strong>
              <div className="pieces">
                {playersHere.map((id) => (
                  <span
                    className={`piece ${id === state.activePlayerId ? "active" : ""}`}
                    style={{ "--piece-color": state.players[id].color } as React.CSSProperties}
                    title={state.players[id].name}
                    key={id}
                  >
                    {id === "player1" ? "焰" : "潮"}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <div className="board-legend">
        <span><i className="legend-battle" />战斗</span>
        <span><i className="legend-treasure" />宝箱</span>
        <span><i className="legend-spring" />泉水</span>
        <span><i className="legend-event" />事件</span>
      </div>
    </section>
  );
}

function BattlePanel({ state, battle, dispatch }: {
  state: GameState;
  battle: BattleState;
  dispatch: React.Dispatch<Parameters<typeof gameReducer>[1]>;
}) {
  const [attackScrollId, setAttackScrollId] = useState("");
  const [defenseScrollId, setDefenseScrollId] = useState("");
  const { a, b } = getBattleParticipants(state, battle);
  const attackerSide = battle.attacker;
  const defenderSide = attackerSide === "a" ? "b" : "a";
  const attackerPlayer = getSidePlayer(state, battle, attackerSide);
  const defenderPlayer = getSidePlayer(state, battle, defenderSide);

  useEffect(() => {
    setAttackScrollId("");
    setDefenseScrollId("");
  }, [battle.round]);

  const nameOf = (side: "a" | "b") => side === "a" ? a.name : b.name;
  const hpMaxB = "maxHp" in b ? b.maxHp : 1;

  return (
    <div className="modal-backdrop">
      <section className="battle-modal">
        <div className="modal-kicker">{battle.kind === "pvp" ? "旅者相遇战" : battle.kind === "boss" ? "最终决战" : "山路遭遇"}</div>
        <h2>{a.name} <span>VS</span> {b.name}</h2>
        <div className="initiative-line">先攻投骰 {battle.initiativeA} : {battle.initiativeB} · 第 {battle.round} 轮</div>
        <div className="combatants">
          <div className={attackerSide === "a" ? "attacking" : ""}>
            <span className="combat-role">{attackerSide === "a" ? "正在攻击" : "防守"}</span>
            <h3>{a.name}</h3>
            <strong>{battle.hpA}/{a.maxHp}</strong>
            <HealthBar value={battle.hpA} max={a.maxHp} />
          </div>
          <div className="clash-mark">⚔</div>
          <div className={attackerSide === "b" ? "attacking" : ""}>
            <span className="combat-role">{attackerSide === "b" ? "正在攻击" : "防守"}</span>
            <h3>{b.name}</h3>
            <strong>{battle.hpB}/{hpMaxB}</strong>
            <HealthBar value={battle.hpB} max={hpMaxB} />
          </div>
        </div>

        <p className="turn-callout"><strong>{nameOf(attackerSide)}</strong>发动攻击，{nameOf(defenderSide)}进行防御。</p>
        <div className="scroll-choices">
          {attackerPlayer && (
            <label>
              攻击方卷轴
              <select value={attackScrollId} onChange={(event) => setAttackScrollId(event.target.value)}>
                <option value="">不使用</option>
                {attackerPlayer.scrolls.filter((scroll) => scroll.kind === "might").map((scroll) => (
                  <option value={scroll.instanceId} key={scroll.instanceId}>力量卷轴（攻击 +3）</option>
                ))}
              </select>
            </label>
          )}
          {defenderPlayer && (
            <label>
              防守方卷轴
              <select value={defenseScrollId} onChange={(event) => setDefenseScrollId(event.target.value)}>
                <option value="">不使用</option>
                {defenderPlayer.scrolls.filter((scroll) => scroll.kind === "guard").map((scroll) => (
                  <option value={scroll.instanceId} key={scroll.instanceId}>护盾卷轴（防御 +3）</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button className="primary-button battle-button" onClick={() => dispatch({
          type: "resolveBattleRound",
          attackScrollId: attackScrollId || undefined,
          defenseScrollId: defenseScrollId || undefined,
        })}>投掷攻防骰</button>
        <div className="battle-log">
          {battle.log.map((entry, index) => <p key={`${battle.round}-${index}`}>{entry}</p>)}
        </div>
      </section>
    </div>
  );
}

function PenaltyPanel({ state, dispatch }: {
  state: GameState;
  dispatch: React.Dispatch<Parameters<typeof gameReducer>[1]>;
}) {
  if (state.phase.kind !== "pvpPenalty") return null;
  const { winnerId, loserId } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];
  const hpAmount = Math.min(3, winner.maxHp - winner.hp, loser.hp - 1);
  return (
    <div className="modal-backdrop">
      <section className="penalty-modal">
        <div className="modal-kicker">相遇战代价</div>
        <h2>{loser.name}选择交付</h2>
        <p>胜者是{winner.name}。生命已经回溯，战斗中消耗的卷轴不会返还。</p>
        <div className="penalty-options">
          {loser.scrolls.map((item) => (
            <button key={item.instanceId} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "scroll", instanceId: item.instanceId })}>
              <span>交出卷轴</span><strong>{SCROLLS[item.kind].name}</strong>
            </button>
          ))}
          {loser.equipment.map((item) => (
            <button key={item.instanceId} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "equipment", instanceId: item.instanceId })}>
              <span>交出装备</span><strong>{EQUIPMENT[item.kind].name}</strong>
            </button>
          ))}
          {hpAmount > 0 && (
            <button onClick={() => dispatch({ type: "choosePvpPenalty", choice: "hp" })}>
              <span>转移生命</span><strong>{hpAmount} 点生命</strong>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function GameOverPanel({ state, dispatch }: {
  state: GameState;
  dispatch: React.Dispatch<Parameters<typeof gameReducer>[1]>;
}) {
  if (state.phase.kind !== "gameOver") return null;
  const winner = state.players[state.phase.winnerId];
  return (
    <div className="modal-backdrop victory-backdrop">
      <section className="victory-modal">
        <span className="crown">♛</span>
        <div className="modal-kicker">登峰之冠</div>
        <h2>{winner.name}获胜</h2>
        <p>巨龙已经倒下，山巅见证了新的冠军。</p>
        <button className="primary-button" onClick={() => dispatch({ type: "restart" })}>再来一局</button>
      </section>
    </div>
  );
}

function ActionDock({ state, dispatch }: {
  state: GameState;
  dispatch: React.Dispatch<Parameters<typeof gameReducer>[1]>;
}) {
  const active = state.players[state.activePlayerId];
  return (
    <section className="action-dock">
      <div>
        <span className="eyebrow">行动提示</span>
        <p>{state.message}</p>
      </div>
      {state.lastMovementRoll && <div className="die-result" aria-label={`骰子结果 ${state.lastMovementRoll}`}>{state.lastMovementRoll}</div>}
      {state.phase.kind === "awaitingRoll" && (
        <button className="primary-button" onClick={() => dispatch({ type: "rollMovement" })}>为{active.name}投骰</button>
      )}
      {state.phase.kind === "turnComplete" && (
        <button className="primary-button secondary" onClick={() => dispatch({ type: "endTurn" })}>结束回合</button>
      )}
    </section>
  );
}

export function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createInitialGame());
  const activeName = state.players[state.activePlayerId].name;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D/S</span>
          <div><span>Dicebound Summit</span><h1>骰境登峰</h1></div>
        </div>
        <div className="round-status">
          <span>行动 {state.turn}</span>
          <strong>{activeName}</strong>
        </div>
        <button className="ghost-button" onClick={() => dispatch({ type: "restart" })}>重新开局</button>
      </header>

      <div className="game-layout">
        <PlayerPanel player={state.players.player1} active={state.activePlayerId === "player1"} />
        <Board state={state} />
        <PlayerPanel player={state.players.player2} active={state.activePlayerId === "player2"} />
      </div>

      <ActionDock state={state} dispatch={dispatch} />
      <details className="history-panel">
        <summary>冒险记录</summary>
        {state.history.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}
      </details>

      {state.phase.kind === "battle" && <BattlePanel state={state} battle={state.phase.battle} dispatch={dispatch} />}
      <PenaltyPanel state={state} dispatch={dispatch} />
      <GameOverPanel state={state} dispatch={dispatch} />
    </main>
  );
}
