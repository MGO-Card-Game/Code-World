import { useState } from "react";
import { EQUIPMENT } from "../game/content/equipment";
import { SCROLLS } from "../game/content/scrolls";
import type {
  CombatSide,
  EncounterDecisionState,
  GameStateView,
  PlayerId,
  TradeConfirmationState,
  TradeOffer,
  TradeOfferState,
} from "../game/types";
import { DecisionModal } from "./DecisionModal";
import { visibleScrolls, type Dispatch } from "./shared";

function participantSide(
  value: Pick<EncounterDecisionState, "aPlayerId" | "bPlayerId">,
  viewerSeat: PlayerId,
): CombatSide | undefined {
  if (value.aPlayerId === viewerSeat) return "a";
  if (value.bPlayerId === viewerSeat) return "b";
  return undefined;
}

export function EncounterDecisionPanel({ state, encounter, dispatch, viewerSeat }: {
  state: GameStateView;
  encounter: EncounterDecisionState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
}) {
  const a = state.players[encounter.aPlayerId];
  const b = state.players[encounter.bPlayerId];
  const side = participantSide(encounter, viewerSeat);
  const ownChoice = side === "a" ? encounter.choiceA : side === "b" ? encounter.choiceB : undefined;
  const canChoose = side !== undefined && ownChoice?.status === "pending";

  return (
    <DecisionModal
      backdrop="encounter-decision-backdrop"
      className="encounter-decision-modal"
      emblem={<div className="encounter-emblem">⚔</div>}
      kicker="旅者相遇 · 独立选择"
      title={`${a.name}遇见了${b.name}`}
      lead="任一方选择战斗都会立即开战；只有双方都选择交易，才会进入报价。"
      canAct={canChoose && side !== undefined}
      waiting={
        <p className="waiting-notice">
          {side && ownChoice?.status !== "pending" ? "选择已提交，等待对方……" : "等待相遇双方作出选择……"}
        </p>
      }
      actions={side && (
        <div className="encounter-intent-options">
          <button onClick={() => dispatch({ type: "chooseEncounterIntent", side, intent: "battle" })}>
            <span>强制优先</span><strong>发起战斗</strong><small>无需对方同意</small>
          </button>
          <button onClick={() => dispatch({ type: "chooseEncounterIntent", side, intent: "trade" })}>
            <span>需要共识</span><strong>提出交易</strong><small>双方都选择才会继续</small>
          </button>
          <button onClick={() => dispatch({ type: "chooseEncounterIntent", side, intent: "greet" })}>
            <span>和平意向</span><strong>友好招呼</strong><small>若无人开战则相安无事</small>
          </button>
        </div>
      )}
    />
  );
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function TradeOfferPanel({ state, trade, dispatch, viewerSeat }: {
  state: GameStateView;
  trade: TradeOfferState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
}) {
  const side = participantSide(trade, viewerSeat);
  const player = side ? state.players[viewerSeat] : undefined;
  const ownChoice = side === "a" ? trade.offerA : side === "b" ? trade.offerB : undefined;
  const [gold, setGold] = useState(0);
  const [scrollIds, setScrollIds] = useState<string[]>([]);
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const scrolls = player ? visibleScrolls(player.scrolls) : [];
  const canEdit = side !== undefined && player !== undefined && ownChoice?.status === "pending";
  const hasOffer = gold > 0 || scrollIds.length > 0 || equipmentIds.length > 0;

  return (
    <DecisionModal
      backdrop="trade-backdrop"
      className="trade-offer-modal"
      emblem={<div className="trade-emblem">⇄</div>}
      kicker="秘密报价"
      title="准备你的交易报价"
      lead="双方提交前互相看不到内容；报价都提交后会公开，再进行最终确认。"
      canAct={canEdit && player !== undefined && side !== undefined}
      waiting={
        <>
          <p className="waiting-notice">
            {side && ownChoice?.status !== "pending" ? "报价已提交，等待对方……" : "等待交易双方提交报价……"}
          </p>
          {side && (
            <button className="ghost-button trade-cancel" onClick={() => dispatch({ type: "cancelTrade", side })}>
              取消交易
            </button>
          )}
        </>
      }
      actions={player && side && (
        <>
            <label className="trade-gold-field">
              <span>金币（持有 {player.gold}）</span>
              <input
                type="number"
                min={0}
                max={player.gold}
                step={1}
                value={gold}
                onChange={(event) => setGold(Math.max(0, Math.min(player.gold, Math.floor(Number(event.target.value) || 0))))}
              />
            </label>
            <div className="trade-resource-section">
              <h3>卷轴</h3>
              <div className="trade-resource-grid">
                {scrolls.length === 0 && <em>没有可报价的卷轴</em>}
                {scrolls.map((item) => (
                  <label className={scrollIds.includes(item.instanceId) ? "selected" : ""} key={item.instanceId}>
                    <input
                      type="checkbox"
                      checked={scrollIds.includes(item.instanceId)}
                      onChange={() => setScrollIds((values) => toggle(values, item.instanceId))}
                    />
                    <strong>{SCROLLS[item.kind].name}</strong>
                    <small>{SCROLLS[item.kind].description}</small>
                  </label>
                ))}
              </div>
            </div>
            <div className="trade-resource-section">
              <h3>装备</h3>
              <div className="trade-resource-grid">
                {player.equipment.length === 0 && <em>没有可报价的装备</em>}
                {player.equipment.map((item) => (
                  <label className={equipmentIds.includes(item.instanceId) ? "selected" : ""} key={item.instanceId}>
                    <input
                      type="checkbox"
                      checked={equipmentIds.includes(item.instanceId)}
                      onChange={() => setEquipmentIds((values) => toggle(values, item.instanceId))}
                    />
                    <strong>{EQUIPMENT[item.kind].name}</strong>
                    <small>{EQUIPMENT[item.kind].description}</small>
                  </label>
                ))}
              </div>
            </div>
            <button
              className="primary-button trade-submit"
              disabled={!hasOffer}
              onClick={() => dispatch({
                type: "submitTradeOffer",
                side,
                gold,
                scrollInstanceIds: scrollIds,
                equipmentInstanceIds: equipmentIds,
              })}
            >
              提交报价
            </button>
          <button className="ghost-button trade-cancel" onClick={() => dispatch({ type: "cancelTrade", side })}>
            取消交易
          </button>
        </>
      )}
    >
      {trade.error && <p className="trade-error">{trade.error}</p>}
    </DecisionModal>
  );
}

function OfferSummary({ playerName, offer }: { playerName: string; offer: TradeOffer }) {
  return (
    <div className="trade-offer-summary">
      <h3>{playerName}交出</h3>
      {offer.gold > 0 && <div><span>金币</span><strong>{offer.gold}</strong></div>}
      {offer.scrolls.map((item) => (
        <div key={item.instanceId}><span>卷轴</span><strong>{SCROLLS[item.kind].name}</strong></div>
      ))}
      {offer.equipment.map((item) => (
        <div key={item.instanceId}><span>装备</span><strong>{EQUIPMENT[item.kind].name}</strong></div>
      ))}
    </div>
  );
}

export function TradeConfirmationPanel({ state, trade, dispatch, viewerSeat }: {
  state: GameStateView;
  trade: TradeConfirmationState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
}) {
  const side = participantSide(trade, viewerSeat);
  const ownConfirmation = side === "a" ? trade.confirmationA : side === "b" ? trade.confirmationB : undefined;
  const canConfirm = side !== undefined && ownConfirmation === "pending";
  const a = state.players[trade.aPlayerId];
  const b = state.players[trade.bPlayerId];

  return (
    <DecisionModal
      backdrop="trade-backdrop"
      className="trade-confirmation-modal"
      emblem={<div className="trade-emblem">⇄</div>}
      kicker="最终确认"
      title="核对双方报价"
      lead="两人都确认后才会原子交换；任一方取消，所有资源保持原样。"
      canAct={canConfirm && side !== undefined}
      waiting={<p className="waiting-notice">等待尚未确认的一方……</p>}
      actions={side && (
        <div className="trade-confirmation-actions">
          <button className="primary-button" onClick={() => dispatch({ type: "confirmTrade", side, accept: true })}>确认交易</button>
          <button className="ghost-button" onClick={() => dispatch({ type: "confirmTrade", side, accept: false })}>取消交易</button>
        </div>
      )}
    >
      <div className="trade-comparison">
        <OfferSummary playerName={a.name} offer={trade.offerA} />
        <OfferSummary playerName={b.name} offer={trade.offerB} />
      </div>
      <div className="trade-confirmation-status">
        <span>{a.name}：{trade.confirmationA === "accepted" ? "已确认" : "待确认"}</span>
        <span>{b.name}：{trade.confirmationB === "accepted" ? "已确认" : "待确认"}</span>
      </div>
    </DecisionModal>
  );
}
