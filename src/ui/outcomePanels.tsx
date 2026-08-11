import { motion } from "framer-motion";
import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  equipmentCategory,
} from "../game/content/equipment";
import { SCROLLS } from "../game/content/scrolls";
import { blessingDefinition } from "../game/content/blessings";
import { mapEventDefinition, type MapEventCategory } from "../game/content/events";
import { blessingCapacity } from "../game/blessings";
import { enemyDefinition } from "../game/content/enemies";
import { scrollDefinition } from "../game/content/scrolls";
import { requirementValueForRegion } from "../game/stages";
import { STAT_GROWTH, STAT_GROWTH_OPTIONS } from "../game/growth";
import { getAttack, getDefense, pvpHpTransferAmount } from "../game/selectors";
import { bossKeyPrice, equipmentSalvageValue, pvpGoldTransferAmount } from "../game/economy";
import type {
  BlessingChoiceState,
  BossGateChoiceState,
  EquipmentChoiceState,
  EncounterChoiceState,
  ScrollTargetChoiceState,
  GameStateView,
  MapEventNoticeState,
  PlayerId,
  PlayerView,
  PveRewardItem,
  PveRewardNoticeState,
  PvpPenaltyState,
  StatGrowthChoiceState,
  StatGrowthOption,
} from "../game/types";
import type { ReactNode } from "react";
import { ModalBackdrop, SPRING, visibleScrolls, type Dispatch } from "./shared";

/**
 * 战斗之后的规则弹层：赐福覆盖、相遇战代价、装备槽已满、终局。
 * 它们共享同一个 AnimatePresence，都要等战斗演出播完才登场。
 */

function DecisionMinimizeButton({ onMinimize }: { onMinimize: () => void }) {
  return (
    <button
      type="button"
      className="decision-minimize-button"
      onClick={onMinimize}
      aria-label="暂时隐藏选择界面以查看其他信息"
    >
      <span aria-hidden="true">—</span>
      暂时隐藏
    </button>
  );
}

/**
 * 规则弹层的外壳。
 *
 * 九个弹层的骨架是同一副：遮罩、同一套进出场动画、可选的暂时隐藏按钮与徽记、
 * 眉标题、主标题、导语，最后是「轮到自己就给操作，轮不到就说明在等谁」。各面板
 * 只留自己的正文和按钮，其余都由这里收口——此前进出场参数已经漂成三套
 * （0.9/18、0.9/20、0.94/14），差异没有任何设计意图，纯粹是复制粘贴的沉积。
 *
 * decision-modal 不用调用方自己挂：它提供的是暂时隐藏按钮所需的定位上下文，
 * 有没有那个按钮由 onMinimize 决定，两者本来就该同进同出。
 */
function DecisionModal({
  className,
  backdrop,
  emblem,
  kicker,
  title,
  lead,
  onMinimize,
  canAct,
  waiting,
  actions,
  children,
}: {
  className: string;
  backdrop?: string;
  emblem?: ReactNode;
  kicker: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  onMinimize?: () => void;
  canAct: boolean;
  /** 轮不到观看者操作时，「等待……」中间的那一段 */
  waiting: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <ModalBackdrop className={backdrop}>
      <motion.section
        className={onMinimize ? `${className} decision-modal` : className}
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={SPRING}
      >
        {onMinimize && <DecisionMinimizeButton onMinimize={onMinimize} />}
        {emblem}
        <div className="modal-kicker">{kicker}</div>
        <h2>{title}</h2>
        {lead !== undefined && <p>{lead}</p>}
        {children}
        {canAct ? actions : <p className="waiting-notice">等待{waiting}……</p>}
      </motion.section>
    </ModalBackdrop>
  );
}

/** 战利品与事件通知共用的圆形徽记。 */
function NoticeEmblem({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="reward-emblem"
      initial={{ scale: 0.5, rotate: -18 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ delay: 0.12, type: "spring", stiffness: 280, damping: 16 }}
    >{children}</motion.div>
  );
}

/** 逐条渐次浮现的列表项，战利品与事件旁白共用同一条节奏。 */
function staggered(index: number) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.16 + index * 0.08 },
  };
}

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
  const keyPurchased = player.stageProgress[region.id].bossKeyPurchased;
  const keyPrice = bossKeyPrice(state.map, region.id);
  const hasStageRequirements = region.requirements.length > 0;
  return (
    <DecisionModal
      backdrop="boss-gate-backdrop"
      className="boss-gate-modal"
      emblem={<div className="boss-gate-emblem">♛</div>}
      kicker={`${region.name} · 守关挑战`}
      title={`${boss.name}正在门后等待`}
      lead={keyPurchased
        ? `${player.name}已经持有本阶段钥匙，可以挑战首领，也可以继续绕行整备。`
        : hasStageRequirements
          ? `${player.name}已经完成本阶段目标，还需购买首领钥匙才能进入。`
          : `${player.name}无需完成阶段任务，购买首领钥匙后即可进入。`}
      canAct={canChoose}
      waiting={`${player.name}处理首领入口`}
      actions={
        <div className="boss-gate-actions">
          {keyPurchased ? (
            <button className="primary-button" onClick={() => dispatch({ type: "chooseBossChallenge", challenge: true })}>
              挑战{boss.name}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={player.gold < keyPrice}
              onClick={() => dispatch({ type: "buyBossKey" })}
            >
              {player.gold < keyPrice ? `金币不足 · 需要 ${keyPrice}` : `购买钥匙 · ${keyPrice} 金币`}
            </button>
          )}
          <button className="primary-button secondary" onClick={() => dispatch({ type: "chooseBossChallenge", challenge: false })}>
            {keyPurchased ? "暂不进入" : "暂不购买"}
          </button>
        </div>
      }
    >
      {hasStageRequirements && (
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
      )}
    </DecisionModal>
  );
}

export function PveRewardPanel({ state, notice, dispatch, viewerSeat, onMinimize }: {
  state: GameStateView;
  notice: PveRewardNoticeState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
  onMinimize: () => void;
}) {
  const player = state.players[notice.playerId];
  const canAcknowledge = viewerSeat === notice.playerId;
  const sourceNames = {
    battle: "战斗奖励",
    affix: "词条额外奖励",
    elite: "精英额外奖励",
    boss: "首领战利品",
    blessing: "战争财阀",
  } as const satisfies Record<PveRewardItem["source"], string>;
  const boss = notice.rewards.some((reward) => reward.source === "boss");

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="pve-reward-modal"
      onMinimize={onMinimize}
      emblem={<NoticeEmblem>{boss ? "♛" : notice.elite ? "✦" : "◆"}</NoticeEmblem>}
      kicker={boss ? "阶段首领已倒下" : notice.elite ? "精英讨伐成功" : "战斗胜利"}
      title={`${player.name}击败了${notice.enemyName}`}
      lead={boss
        ? "关隘就此打开，战利品已经收入行囊。"
        : notice.elite
          ? "强敌倒下，额外战利品已经收入行囊。"
          : "战利品已经收入行囊。"}
      canAct={canAcknowledge}
      waiting={`${player.name}确认奖励`}
      actions={
        <button className="primary-button" onClick={() => dispatch({ type: "acknowledgePveReward" })}>
          {notice.statGrowth ? "收下奖励并加点" : "收下奖励"}
        </button>
      }
    >
      <div className="pve-reward-list">
        {notice.rewards.map((reward, index) => (
          <motion.div
            key={`${reward.source}-${index}-${reward.name}`}
            className={`pve-reward-item source-${reward.source}`}
            {...staggered(index)}
          >
            <span>{sourceNames[reward.source]}</span>
            <strong>{reward.name}</strong>
            <small>{
              reward.resourceType === "scroll"
                ? "卷轴"
                : reward.resourceType === "equipment"
                  ? "装备"
                  : "金币"
            }</small>
          </motion.div>
        ))}
      </div>
    </DecisionModal>
  );
}

/**
 * 事件格结算通知。
 *
 * 事件的名称与描述来自内容表，逐条旁白来自本次结算——两者都摆出来，玩家才知道
 * 「踩到了什么」和「发生了什么」。改这里之前先看 MapEventNoticeState 的注释。
 */
export function MapEventPanel({ state, notice, dispatch, viewerSeat, onMinimize }: {
  state: GameStateView;
  notice: MapEventNoticeState;
  dispatch: Dispatch;
  viewerSeat: PlayerId;
  onMinimize: () => void;
}) {
  const player = state.players[notice.playerId];
  const definition = mapEventDefinition(notice.kind);
  const canAcknowledge = viewerSeat === notice.playerId;
  const categoryNames = {
    recovery: "休整",
    hazard: "险情",
    reward: "机遇",
    boon: "际遇",
    casino: "赌局",
  } as const satisfies Record<MapEventCategory, string>;
  const emblems = {
    recovery: "✚",
    hazard: "⚠",
    reward: "◈",
    boon: "✧",
    casino: "◉",
  } as const satisfies Record<MapEventCategory, string>;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className={`map-event-modal event-${definition.category}`}
      onMinimize={onMinimize}
      emblem={<NoticeEmblem>{emblems[definition.category]}</NoticeEmblem>}
      kicker={categoryNames[definition.category]}
      title={definition.name}
      lead={definition.description}
      canAct={canAcknowledge}
      waiting={`${player.name}确认`}
      actions={
        <button className="primary-button" onClick={() => dispatch({ type: "acknowledgeMapEvent" })}>
          {notice.resume?.kind === "casino"
            ? "走进赌场"
            : notice.resume?.kind === "equipmentChoice"
              ? "处理装备"
              : "继续前行"}
        </button>
      }
    >
      <div className="map-event-lines">
        {notice.lines.map((line, index) => (
          <motion.p key={`${index}-${line.text}`} {...staggered(index)}>
            {line.text}
          </motion.p>
        ))}
      </div>
    </DecisionModal>
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
  const goldAmount = pvpGoldTransferAmount(loser);
  const canChoose = viewerSeat === penalty.loserId;
  return (
    <DecisionModal
      className="penalty-modal"
      kicker="相遇战代价"
      title={`${loser.name}选择交付`}
      lead={`胜者是${winner.name}。生命已经回溯，战斗中消耗的卷轴不会返还。`}
      canAct={canChoose}
      waiting={`${loser.name}选择代价`}
      actions={
        <div className="penalty-options">
          {goldAmount > 0 && (
            <button disabled={playing} onClick={() => dispatch({ type: "choosePvpPenalty", choice: "gold" })}>
              <span>支付 20% 金币</span><strong>{goldAmount} 金币</strong>
            </button>
          )}
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
        </div>
      }
    />
  );
}

export function BlessingChoicePanel({ state, choice, dispatch, playing, viewerSeat, onMinimize }: {
  state: GameStateView;
  choice: BlessingChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
  onMinimize: () => void;
}) {
  const winner = state.players[choice.winnerId];
  const loser = choice.source === "pvp" ? state.players[choice.loserId] : undefined;
  const offeredDefinition = blessingDefinition(choice.offered.kind);
  const capacity = blessingCapacity(winner);
  const canChoose = viewerSeat === choice.winnerId;

  return (
    <DecisionModal
      className="blessing-choice-modal"
      onMinimize={onMinimize}
      kicker="赐福抉择"
      title={choice.source === "pvp"
        ? `${winner.name}夺得了${loser!.name}的赐福`
        : `${winner.name}在${choice.tileLabel}发现新的赐福`}
      lead={`当前赐福槽位 ${winner.blessings.length}/${capacity}。接纳新赐福时，被替换的赐福会永久消失。`}
      canAct={canChoose}
      waiting={`${winner.name}选择赐福`}
      actions={
        <div className="blessing-choice-options">
          <button disabled={playing} onClick={() => dispatch({ type: "chooseBlessing", replace: false })}>
            <span>放弃新赐福</span>
            <strong>保留全部已有赐福</strong>
          </button>
          {winner.blessings.map((current) => {
            const definition = blessingDefinition(current.kind);
            return (
              <button
                className="replace-blessing"
                disabled={playing}
                key={current.instanceId}
                onClick={() => dispatch({
                  type: "chooseBlessing",
                  replace: true,
                  replaceInstanceId: current.instanceId,
                })}
              >
                <span>替换{definition.name}</span>
                <strong>接纳{offeredDefinition.name}</strong>
              </button>
            );
          })}
        </div>
      }
    >
      <div className="blessing-comparison">
        {winner.blessings.map((current) => {
          const definition = blessingDefinition(current.kind);
          return (
            <div key={current.instanceId}>
              <span>已有赐福</span>
              <strong>{definition.name}</strong>
              <small>{definition.description}</small>
            </div>
          );
        })}
        <div className="offered">
          <span>{choice.source === "pvp" ? "败方赐福" : "新赐福"}</span>
          <strong>{offeredDefinition.name}</strong>
          <small>{offeredDefinition.description}</small>
        </div>
      </div>
    </DecisionModal>
  );
}

export function ScrollTargetChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: ScrollTargetChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const definition = scrollDefinition(choice.scrollKind);
  const canChoose = viewerSeat === choice.playerId;

  return (
    <DecisionModal
      className="encounter-choice-modal"
      kicker={definition.name}
      title={`${player.name}选择目标`}
      lead={definition.description}
      canAct={canChoose}
      waiting={`${player.name}选择目标`}
      actions={
        <div className="encounter-options">
          {choice.candidateIds.map((targetId) => {
            const target = state.players[targetId];
            // 掉线的人照样能被选中：他不需要做任何操作，掉线不该换来免疫
            const unavailable = state.unavailablePlayerIds.includes(targetId);
            return (
              <button
                type="button"
                key={targetId}
                disabled={playing}
                style={{ "--player-color": target.color } as React.CSSProperties}
                onClick={() => dispatch({ type: "chooseScrollTarget", targetId })}
              >
                <span>{target.name}</span>
                <strong>金币 {target.gold}</strong>
                <small>
                  {`位置 ${state.map.tiles[target.position]?.label ?? "—"}`}
                  {unavailable ? " · 暂时离线" : ""}
                </small>
              </button>
            );
          })}
        </div>
      }
    />
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
    <DecisionModal
      className="encounter-choice-modal"
      kicker="旅者相遇"
      title={`${challenger.name}选择相遇对象`}
      lead="本次移动只会与一名旅者互动，结束后不会继续处理同格的其他玩家。"
      canAct={canChoose}
      waiting={`${challenger.name}选择对手`}
      actions={
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
      }
    />
  );
}

export function EquipmentChoicePanel({ state, choice, dispatch, playing, viewerSeat, onMinimize }: {
  state: GameStateView;
  choice: EquipmentChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
  onMinimize: () => void;
}) {
  const player = state.players[choice.playerId];
  const definition = EQUIPMENT[choice.offered.kind];
  const category = equipmentCategory(choice.offered.kind);
  const replaceable = player.equipment.filter(
    (item) => equipmentCategory(item.kind) === category,
  );
  const canChoose = viewerSeat === choice.playerId;

  return (
    <DecisionModal
      className="equipment-choice-modal"
      onMinimize={onMinimize}
      kicker="装备槽已满"
      title={`${player.name}获得了${definition.name}`}
      canAct={canChoose}
      waiting={`${player.name}选择装备`}
      actions={
        <>
          <p>选择一件同类装备替换，或放弃这件新装备。离场的那一件按品质折算成金币。</p>
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
                <em className="salvage-value">
                  折算 +{equipmentSalvageValue(player, item.kind)} 金币
                </em>
              </button>
            ))}
            <button
              className="discard-equipment"
              disabled={playing}
              onClick={() => dispatch({ type: "chooseEquipment" })}
            >
              <span>不替换</span>
              <strong>放弃新装备</strong>
              <em className="salvage-value">
                折算 +{equipmentSalvageValue(player, choice.offered.kind)} 金币
              </em>
            </button>
          </div>
        </>
      }
    >
      <div className="offered-equipment">
        <span>{definition.rarity} · {EQUIPMENT_CATEGORY_NAMES[category]}</span>
        <strong>{definition.name}</strong>
        <p>{definition.description}</p>
      </div>
    </DecisionModal>
  );
}

export function StatGrowthPanel({ state, choice, dispatch, playing, viewerSeat, onMinimize }: {
  state: GameStateView;
  choice: StatGrowthChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
  onMinimize: () => void;
}) {
  const player = state.players[choice.playerId];
  const region = state.map.regions.find((candidate) => candidate.id === choice.stageId);
  const canChoose = viewerSeat === choice.playerId;
  const current: Record<StatGrowthOption, string> = {
    attack: `当前 ${getAttack(player)}`,
    defense: `当前 ${getDefense(player)}`,
    maxHp: `当前 ${player.hp}/${player.maxHp}`,
  };

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="stat-growth-modal"
      onMinimize={onMinimize}
      kicker={region ? `${region.name}·登顶之证` : "登顶之证"}
      title={`${player.name}的永久成长`}
      lead="击败阶段首领的奖赏，一局只有两次，选定后不可更改。"
      canAct={canChoose}
      waiting={`${player.name}分配成长`}
      actions={
        <div className="stat-growth-options">
          {STAT_GROWTH_OPTIONS.map((option) => (
            <button
              key={option}
              disabled={playing}
              onClick={() => dispatch({ type: "chooseStatGrowth", option })}
            >
              <strong>{STAT_GROWTH[option].name}</strong>
              <small>{STAT_GROWTH[option].description}</small>
              <em>{current[option]}</em>
            </button>
          ))}
        </div>
      }
    />
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
