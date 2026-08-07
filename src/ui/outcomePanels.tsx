import { motion } from "framer-motion";
import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  equipmentCategory,
} from "../game/content/equipment";
import { SCROLLS } from "../game/content/scrolls";
import { blessingDefinition } from "../game/content/blessings";
import { enemyDefinition } from "../game/content/enemies";
import { requirementValueForRegion } from "../game/stages";
import { getAttack, getDefense, pvpHpTransferAmount } from "../game/selectors";
import type {
  BlessingChoiceState,
  BossGateChoiceState,
  EquipmentChoiceState,
  EncounterChoiceState,
  GameStateView,
  PlayerId,
  PlayerView,
  PveRewardNoticeState,
  PvpPenaltyState,
} from "../game/types";
import { ModalBackdrop, SPRING, visibleScrolls, type Dispatch } from "./shared";

/**
 * 战斗之后的规则弹层：赐福覆盖、相遇战代价、装备槽已满、终局。
 * 它们共享同一个 AnimatePresence，都要等战斗演出播完才登场。
 */

export function BossGatePanel({ state, choice, dispatch, viewerSeat }: {
  state: GameStateView;
  choice: BossGateChoiceState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const region = state.map.regions.find((candidate) => candidate.id === choice.stageId)!;
  const boss = enemyDefinition(choice.bossEnemyId);
  const canChoose = viewerSeat === choice.playerId;
  return (
    <ModalBackdrop className="boss-gate-backdrop">
      <motion.section
        className="boss-gate-modal"
        initial={{ opacity: 0, scale: 0.9, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 8 }}
        transition={SPRING}
      >
        <div className="boss-gate-emblem">♛</div>
        <div className="modal-kicker">{region.name} · 守关挑战</div>
        <h2>{boss.name}正在门后等待</h2>
        <p>{player.name}已经完成本阶段目标，可以立即挑战首领，也可以继续绕行整备。</p>
        <div className="boss-requirements">
          {region.requirements.map((requirement) => {
            const value = requirementValueForRegion(player, region.id, requirement);
            return (
              <div key={`${requirement.type}-${requirement.target}`}>
                <span>{requirement.label}</span>
                <strong>{Math.min(value, requirement.target)}/{requirement.target}</strong>
              </div>
            );
          })}
        </div>
        {canChoose ? (
          <div className="boss-gate-actions">
            <button className="primary-button" onClick={() => dispatch({ type: "chooseBossChallenge", challenge: true })}>
              挑战{boss.name}
            </button>
            <button className="primary-button secondary" onClick={() => dispatch({ type: "chooseBossChallenge", challenge: false })}>
              继续整备
            </button>
          </div>
        ) : (
          <p className="waiting-notice">等待{player.name}决定是否挑战……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

export function PveRewardPanel({ state, notice, dispatch, viewerSeat }: {
  state: GameStateView;
  notice: PveRewardNoticeState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
}) {
  const player = state.players[notice.playerId];
  const canAcknowledge = viewerSeat === notice.playerId;
  const sourceNames = {
    battle: "战斗奖励",
    elite: "精英额外奖励",
    blessing: "战争财阀",
  } as const;

  return (
    <ModalBackdrop className="reward-backdrop">
      <motion.section
        className="pve-reward-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        transition={SPRING}
      >
        <motion.div
          className="reward-emblem"
          initial={{ scale: 0.5, rotate: -18 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 280, damping: 16 }}
        >{notice.elite ? "✦" : "◆"}</motion.div>
        <div className="modal-kicker">{notice.elite ? "精英讨伐成功" : "战斗胜利"}</div>
        <h2>{player.name}击败了{notice.enemyName}</h2>
        <p>{notice.elite ? "强敌倒下，额外战利品已经收入行囊。" : "战利品已经收入行囊。"}</p>
        <div className="pve-reward-list">
          {notice.rewards.map((reward, index) => (
            <motion.div
              key={`${reward.source}-${index}-${reward.name}`}
              className={`pve-reward-item source-${reward.source}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 + index * 0.08 }}
            >
              <span>{sourceNames[reward.source]}</span>
              <strong>{reward.name}</strong>
              <small>{reward.resourceType === "scroll" ? "卷轴" : "装备"}</small>
            </motion.div>
          ))}
        </div>
        {canAcknowledge ? (
          <button className="primary-button" onClick={() => dispatch({ type: "acknowledgePveReward" })}>
            收下奖励
          </button>
        ) : (
          <p className="waiting-notice">等待{player.name}确认奖励……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

export function PenaltyPanel({ state, penalty, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  penalty: PvpPenaltyState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const winner = state.players[penalty.winnerId];
  const loser = state.players[penalty.loserId];
  // 和引擎共用同一个算法，界面画出的选项必然是引擎接受的选项
  const hpAmount = pvpHpTransferAmount(winner, loser);
  const canChoose = viewerSeat === penalty.loserId;
  return (
    <ModalBackdrop>
      <motion.section
        className="penalty-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">相遇战代价</div>
        <h2>{loser.name}选择交付</h2>
        <p>胜者是{winner.name}。生命已经回溯，战斗中消耗的卷轴不会返还。</p>
        {canChoose ? <div className="penalty-options">
          {/* 代价由败方来付，视图里正是他自己的手牌，所以牌面可见 */}
          {visibleScrolls(loser.scrolls).map((item) => (
            <button key={item.instanceId} disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "scroll", instanceId: item.instanceId })}>
              <span>交出卷轴</span><strong>{SCROLLS[item.kind].name}</strong>
            </button>
          ))}
          {loser.equipment.map((item) => (
            <button key={item.instanceId} disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "resource", resourceType: "equipment", instanceId: item.instanceId })}>
              <span>交出装备</span><strong>{EQUIPMENT[item.kind].name}</strong>
            </button>
          ))}
          {hpAmount > 0 && (
            <button disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "hp" })}>
              <span>转移生命</span><strong>{hpAmount} 点生命</strong>
            </button>
          )}
        </div> : <p className="waiting-notice">等待{loser.name}选择代价……</p>}
      </motion.section>
    </ModalBackdrop>
  );
}

export function BlessingChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: BlessingChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const winner = state.players[choice.winnerId];
  const loser = state.players[choice.loserId];
  const current = winner.blessings[0];
  const currentDefinition = current ? blessingDefinition(current.kind) : undefined;
  const offeredDefinition = blessingDefinition(choice.offered.kind);
  const canChoose = viewerSeat === choice.winnerId;

  return (
    <ModalBackdrop>
      <motion.section
        className="blessing-choice-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">赐福抉择</div>
        <h2>{winner.name}夺得了{loser.name}的赐福</h2>
        <p>每名玩家只能持有一个赐福。选择覆盖后，原赐福会永久消失。</p>
        <div className="blessing-comparison">
          <div>
            <span>当前赐福</span>
            <strong>{currentDefinition?.name ?? "无"}</strong>
            <small>{currentDefinition?.description ?? "当前没有赐福"}</small>
          </div>
          <div className="offered">
            <span>败方赐福</span>
            <strong>{offeredDefinition.name}</strong>
            <small>{offeredDefinition.description}</small>
          </div>
        </div>
        {canChoose ? (
          <div className="blessing-choice-options">
            <button disabled={playing} onClick={() => dispatch({ type: "chooseBlessing", replace: false })}>
              <span>保留当前赐福</span>
              <strong>{currentDefinition?.name ?? "不覆盖"}</strong>
            </button>
            <button className="replace-blessing" disabled={playing} onClick={() => dispatch({ type: "chooseBlessing", replace: true })}>
              <span>覆盖原赐福</span>
              <strong>接纳{offeredDefinition.name}</strong>
            </button>
          </div>
        ) : (
          <p className="waiting-notice">等待{winner.name}选择赐福……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

export function EncounterChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: EncounterChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const challenger = state.players[choice.challengerId];
  const canChoose = viewerSeat === choice.challengerId;

  return (
    <ModalBackdrop>
      <motion.section
        className="encounter-choice-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">旅者相遇</div>
        <h2>{challenger.name}选择对手</h2>
        <p>本次移动只会触发一场相遇战，战斗结束后不会继续挑战同格的其他玩家。</p>
        {canChoose ? (
          <div className="encounter-options">
            {choice.opponentIds.map((opponentId) => {
              const opponent = state.players[opponentId];
              const unavailable = state.unavailablePlayerIds.includes(opponentId);
              return (
                <button
                  type="button"
                  key={opponentId}
                  disabled={playing || unavailable}
                  style={{ "--player-color": opponent.color } as React.CSSProperties}
                  onClick={() => dispatch({ type: "chooseEncounterOpponent", opponentId })}
                >
                  <span>{opponent.name}</span>
                  <strong>生命 {opponent.hp}/{opponent.maxHp}</strong>
                  <small>{unavailable ? "暂时离线" : `攻击 ${getAttack(opponent)} · 防御 ${getDefense(opponent)}`}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="waiting-notice">等待{challenger.name}选择对手……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

export function EquipmentChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: EquipmentChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const definition = EQUIPMENT[choice.offered.kind];
  const category = equipmentCategory(choice.offered.kind);
  const replaceable = player.equipment.filter(
    (item) => equipmentCategory(item.kind) === category,
  );
  const canChoose = viewerSeat === choice.playerId;

  return (
    <ModalBackdrop>
      <motion.section
        className="equipment-choice-modal"
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        <div className="modal-kicker">装备槽已满</div>
        <h2>{player.name}获得了{definition.name}</h2>
        <div className="offered-equipment">
          <span>{definition.rarity} · {EQUIPMENT_CATEGORY_NAMES[category]}</span>
          <strong>{definition.name}</strong>
          <p>{definition.description}</p>
        </div>
        {canChoose ? (
          <>
            <p>选择一件同类装备替换，或放弃这件新装备。</p>
            <div className="equipment-choice-options">
              {replaceable.map((item) => (
                <button
                  key={item.instanceId}
                  disabled={playing}
                  onClick={() => dispatch({
                    type: "chooseEquipment",
                    replaceInstanceId: item.instanceId,
                  })}
                >
                  <span>替换</span>
                  <strong>{EQUIPMENT[item.kind].name}</strong>
                  <small>{EQUIPMENT[item.kind].description}</small>
                </button>
              ))}
              <button
                className="discard-equipment"
                disabled={playing}
                onClick={() => dispatch({ type: "chooseEquipment" })}
              >
                <span>不替换</span>
                <strong>放弃新装备</strong>
              </button>
            </div>
          </>
        ) : (
          <p className="waiting-notice">等待{player.name}选择装备……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}

export function GameOverPanel({ winner, dispatch, canRestart = true }: {
  winner: PlayerView;
  dispatch: Dispatch;
  canRestart?: boolean;
}) {
  return (
    <ModalBackdrop className="victory-backdrop">
      <motion.section
        className="victory-modal"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
      >
        <motion.span
          className="crown"
          initial={{ y: -30, rotate: -20, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 14 }}
        >♛</motion.span>
        <div className="modal-kicker">登峰之冠</div>
        <h2>{winner.name}获胜</h2>
        <p>巨龙已经倒下，山巅见证了新的冠军。</p>
        {canRestart ? (
          <button className="primary-button" onClick={() => dispatch({ type: "restart" })}>再来一局</button>
        ) : (
          <p className="waiting-notice">等待房主重新开局……</p>
        )}
      </motion.section>
    </ModalBackdrop>
  );
}
