import { useState } from "react";
import {
  debugClearScrolls,
  debugGrantEquipment,
  debugGrantScroll,
  debugMoveTo,
  debugSetHp,
  debugStockHand,
} from "./game/debug";
import type { GameState, PlayerId } from "./game/types";

/**
 * 本地调试面板。只在开发模式渲染（调用方用 import.meta.env.DEV 包裹），
 * 且只出现在本地对局里——联机状态由服务器持有，客户端改不了。
 */
export function DebugPanel({ state, onChange }: {
  state: GameState;
  onChange: (next: GameState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<PlayerId>("player1");
  const player = state.players[target];

  if (!open) {
    return (
      <button className="debug-toggle" onClick={() => setOpen(true)} title="仅开发模式可见">
        调试
      </button>
    );
  }

  return (
    <aside className="debug-panel">
      <header>
        <strong>调试面板</strong>
        <button className="ghost-button" onClick={() => setOpen(false)}>收起</button>
      </header>

      <div className="debug-row">
        <span>目标</span>
        <div className="debug-seg">
          {(["player1", "player2"] as PlayerId[]).map((id) => (
            <button
              key={id}
              className={target === id ? "active" : ""}
              onClick={() => setTarget(id)}
            >
              {state.players[id].name}
            </button>
          ))}
        </div>
      </div>

      <div className="debug-stat">
        生命 {player.hp}/{player.maxHp} · 位置 {player.position} · 卷轴 {player.scrolls.length} · 装备 {player.equipment.length}
      </div>

      <div className="debug-row">
        <span>手牌</span>
        <div className="debug-buttons">
          <button onClick={() => onChange(debugStockHand(state, target, 3))}>
            各发 3 张
          </button>
          <button onClick={() => onChange(debugGrantScroll(state, target, "might"))}>
            +力量
          </button>
          <button onClick={() => onChange(debugGrantScroll(state, target, "guard"))}>
            +护盾
          </button>
          <button onClick={() => onChange(debugGrantScroll(state, target, "fate"))}>
            +D20
          </button>
          <button onClick={() => onChange(debugGrantScroll(state, target, "dragonStrike"))}>
            +巨龙
          </button>
          <button onClick={() => onChange(debugClearScrolls(state, target))}>清空</button>
        </div>
      </div>

      <div className="debug-row">
        <span>装备</span>
        <div className="debug-buttons">
          <button onClick={() => onChange(debugGrantEquipment(state, target))}>
            每种各一件
          </button>
        </div>
      </div>

      <div className="debug-row">
        <span>生命</span>
        <div className="debug-buttons">
          <button onClick={() => onChange(debugSetHp(state, target, 1))}>设为 1</button>
          <button onClick={() => onChange(debugSetHp(state, target, player.maxHp))}>
            回满
          </button>
        </div>
      </div>

      <div className="debug-row">
        <span>移动到</span>
        <select
          value={player.position}
          onChange={(event) => onChange(debugMoveTo(state, target, Number(event.target.value)))}
        >
          {state.map.tiles.map((tile) => (
            <option value={tile.id} key={tile.id}>
              {String(tile.id).padStart(2, "0")} {tile.label}
            </option>
          ))}
        </select>
      </div>

      <p className="debug-note">
        改动直接写入本地状态，不经过引擎结算，因此不会产生动画事件。
        想看发牌动画请走正常的宝箱/战斗奖励流程。
      </p>
    </aside>
  );
}
