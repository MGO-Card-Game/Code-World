import { motion } from "framer-motion";
import {
  EQUIPMENT,
  EQUIPMENT_CATEGORY_NAMES,
  equipmentCategory,
  equipmentKeywords,
} from "../game/content/equipment";
import { SCROLLS, scrollKeywords } from "../game/content/scrolls";
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
  BlessingRewardNoticeState,
  BossGateChoiceState,
  EquipmentChoiceState,
  EncounterChoiceState,
  ScrollTargetChoiceState,
  ScrollDiscardChoiceState,
  GameStateView,
  MapEventEquipmentChoiceState,
  MapEventHarmonyChoiceState,
  MapEventScrollChoiceState,
  MapEventTravelChoiceState,
  MapEventNoticeState,
  PlayerId,
  PlayerView,
  PveRewardItem,
  PveRewardNoticeState,
  PvpPenaltyState,
  StatGrowthChoiceState,
  StatGrowthOption,
  TreasureRewardItem,
  TreasureRewardNoticeState,
} from "../game/types";
import { DecisionModal, NoticeEmblem, staggered } from "./DecisionModal";
import {
  CardBlurb,
  ModalBackdrop,
  RuleText,
  SPRING,
  visibleScrolls,
  type Dispatch,
} from "./shared";

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
      waiting={<p className="waiting-notice">{`等待${player.name}处理首领入口……`}</p>}
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

export function PveRewardPanel({ state, notice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  notice: PveRewardNoticeState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
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
      emblem={<NoticeEmblem>{boss ? "♛" : notice.elite ? "✦" : "◆"}</NoticeEmblem>}
      kicker={boss ? "阶段首领已倒下" : notice.elite ? "精英讨伐成功" : "战斗胜利"}
      title={`${player.name}击败了${notice.enemyName}`}
      lead={boss
        ? "关隘就此打开，战利品已经收入行囊。"
        : notice.elite
          ? "强敌倒下，额外战利品已经收入行囊。"
          : "战利品已经收入行囊。"}
      canAct={canAcknowledge}
      waiting={<p className="waiting-notice">{`等待${player.name}确认奖励……`}</p>}
      actions={
        <button
          className="primary-button"
          disabled={playing}
          onClick={() => dispatch({ type: "acknowledgePveReward" })}
        >
          {playing ? "奖励结算中……" : notice.statGrowth ? "收下奖励并加点" : "收下奖励"}
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
export function MapEventPanel({ state, notice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  notice: MapEventNoticeState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
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
      emblem={<NoticeEmblem>{emblems[definition.category]}</NoticeEmblem>}
      kicker={categoryNames[definition.category]}
      title={definition.name}
      lead={<RuleText text={definition.description} />}
      canAct={canAcknowledge}
      waiting={<p className="waiting-notice">{`等待${player.name}确认……`}</p>}
      actions={
        <button
          className="primary-button"
          disabled={playing}
          onClick={() => dispatch({ type: "acknowledgeMapEvent" })}
        >
          {playing
            ? "事件结算中……"
            : notice.resume?.kind === "casino"
            ? "走进赌场"
            : notice.resume?.kind === "equipmentChoice"
              ? "处理装备"
              : notice.resume?.kind === "mapEventScrollChoice"
                ? "选择卷轴"
                : notice.resume?.kind === "mapEventEquipmentChoice"
                  ? "决定是否交易"
                  : notice.resume?.kind === "mapEventTravelChoice"
                    ? "决定是否启程"
                    : notice.resume?.kind === "mapEventHarmonyChoice"
                      ? "选择调和方向"
                    : notice.resume?.kind === "resolveTile"
                      ? "追踪精英"
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

export function TreasureRewardPanel({ state, notice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  notice: TreasureRewardNoticeState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[notice.playerId];
  const canAcknowledge = viewerSeat === notice.playerId;
  const sourceNames = {
    treasure: "宝箱收获",
    blessing: "宝物猎人",
  } as const satisfies Record<TreasureRewardItem["source"], string>;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="pve-reward-modal"
      emblem={<NoticeEmblem>{notice.empty ? "◇" : "◆"}</NoticeEmblem>}
      kicker={notice.empty ? "空宝箱" : "宝箱已开启"}
      title={`${player.name}打开了${notice.tileLabel}`}
      lead={notice.empty ? "箱子里空空如也，这次没有获得任何物品。" : "箱中的收获已经放入行囊。"}
      canAct={canAcknowledge}
      waiting={<p className="waiting-notice">{`等待${player.name}确认开箱结果……`}</p>}
      actions={
        <button
          className="primary-button"
          disabled={playing}
          onClick={() => dispatch({ type: "acknowledgeTreasureReward" })}
        >
          {playing ? "开箱结算中……" : "收下奖励"}
        </button>
      }
    >
      {!notice.empty && (
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
      )}
    </DecisionModal>
  );
}

export function BlessingRewardPanel({ state, notice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  notice: BlessingRewardNoticeState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[notice.playerId];
  const definition = blessingDefinition(notice.blessing.kind);
  const canAcknowledge = viewerSeat === notice.playerId;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="blessing-choice-modal"
      emblem={<NoticeEmblem>✦</NoticeEmblem>}
      kicker="获得赐福"
      title={`${player.name}在${notice.tileLabel}获得了${definition.name}`}
      lead="新的赐福已经生效。"
      canAct={canAcknowledge}
      waiting={<p className="waiting-notice">{`等待${player.name}确认新赐福……`}</p>}
      actions={
        <button
          className="primary-button"
          disabled={playing}
          onClick={() => dispatch({ type: "acknowledgeBlessingReward" })}
        >
          {playing ? "赐福降临中……" : "确认赐福"}
        </button>
      }
    >
      <div className="blessing-comparison">
        <div className="offered">
          <span>新赐福</span>
          <strong>{definition.name}</strong>
          <small><RuleText text={definition.description} /></small>
        </div>
      </div>
    </DecisionModal>
  );
}

export function MapEventScrollChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: MapEventScrollChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const event = mapEventDefinition(choice.eventKind);
  const candidates = visibleScrolls(player.scrolls).filter((scroll) =>
    choice.candidateIds.includes(scroll.instanceId)
  );
  const canChoose = viewerSeat === choice.playerId;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="equipment-choice-modal"
      emblem={<NoticeEmblem>◈</NoticeEmblem>}
      kicker={event.name}
      title={`${player.name}选择要复制的卷轴`}
      lead="原卷轴会保留；复制品将以新的卡牌实例加入手牌。"
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}选择卷轴……`}</p>}
      actions={
        <div className="equipment-choice-options">
          {candidates.map((scroll) => {
            const definition = SCROLLS[scroll.kind];
            return (
              <button
                type="button"
                key={scroll.instanceId}
                disabled={playing}
                onClick={() => dispatch({
                  type: "chooseMapEventScroll",
                  instanceId: scroll.instanceId,
                })}
              >
                <span>复制</span>
                <strong>{definition.name}</strong>
                <small>
                  <CardBlurb
                    keywords={scrollKeywords(definition)}
                    description={definition.description}
                  />
                </small>
              </button>
            );
          })}
        </div>
      }
    />
  );
}

export function MapEventEquipmentChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: MapEventEquipmentChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const event = mapEventDefinition(choice.eventKind);
  const candidates = player.equipment.filter((item) =>
    choice.candidateIds.includes(item.instanceId)
  );
  const canChoose = viewerSeat === choice.playerId;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="equipment-choice-modal"
      emblem={<NoticeEmblem>◈</NoticeEmblem>}
      kicker={event.name}
      title={`${player.name}是否交出一件装备？`}
      lead="交出的装备会永久失去；作为交换，你的基础防御永久 +1。"
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}决定是否交易……`}</p>}
      actions={
        <div className="equipment-choice-options">
          {candidates.map((item) => {
            const definition = EQUIPMENT[item.kind];
            const category = equipmentCategory(item.kind);
            return (
              <button
                type="button"
                key={item.instanceId}
                disabled={playing}
                onClick={() => dispatch({
                  type: "chooseMapEventEquipment",
                  instanceId: item.instanceId,
                })}
              >
                <span>交出 · {EQUIPMENT_CATEGORY_NAMES[category]}</span>
                <strong>{definition.name}</strong>
                <small>
                  <CardBlurb
                    keywords={equipmentKeywords(definition)}
                    description={definition.description}
                  />
                </small>
              </button>
            );
          })}
          <button
            type="button"
            className="discard-equipment"
            disabled={playing}
            onClick={() => dispatch({ type: "chooseMapEventEquipment" })}
          >
            <span>保留全部装备</span>
            <strong>拒绝交易</strong>
            <small>不交出装备，也不获得防御提升。</small>
          </button>
        </div>
      }
    />
  );
}

export function MapEventTravelChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: MapEventTravelChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const event = mapEventDefinition(choice.eventKind);
  const target = state.map.tiles[choice.targetTileIndex];
  const canChoose = viewerSeat === choice.playerId;
  const canAfford = player.gold >= choice.price;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="equipment-choice-modal"
      emblem={<NoticeEmblem>¤</NoticeEmblem>}
      kicker={event.name}
      title={`${player.name}是否搭乘商队？`}
      lead={`支付 ${choice.price} 金币，立即移动到「${target.label}」并进入商店。`}
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}决定是否启程……`}</p>}
      actions={
        <div className="equipment-choice-options">
          <button
            type="button"
            disabled={playing || !canAfford}
            onClick={() => dispatch({ type: "chooseMapEventTravel", accept: true })}
          >
            <span>支付 {choice.price} 金币</span>
            <strong>{canAfford ? `前往${target.label}` : "金币不足"}</strong>
            <small>当前持有 {player.gold} 金币</small>
          </button>
          <button
            type="button"
            className="discard-equipment"
            disabled={playing}
            onClick={() => dispatch({ type: "chooseMapEventTravel", accept: false })}
          >
            <span>不支付金币</span>
            <strong>放弃行程</strong>
            <small>留在当前位置并结束本次事件。</small>
          </button>
        </div>
      }
    />
  );
}

export function MapEventHarmonyChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: MapEventHarmonyChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const player = state.players[choice.playerId];
  const event = mapEventDefinition(choice.eventKind);
  const canChoose = viewerSeat === choice.playerId;
  const amount = choice.amount;

  return (
    <DecisionModal
      backdrop="reward-backdrop"
      className="equipment-choice-modal"
      emblem={<NoticeEmblem>⇄</NoticeEmblem>}
      kicker={event.name}
      title={`${player.name}要如何调和攻守？`}
      lead={`当前基础攻击 ${player.baseAttack}，基础防御 ${player.baseDefense}。你可以转换 ${amount} 点属性，也可以维持现状。`}
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}选择调和方向……`}</p>}
      actions={
        <div className="equipment-choice-options">
          <button
            type="button"
            disabled={playing || player.baseAttack < amount}
            onClick={() => dispatch({ type: "chooseMapEventHarmony", option: "attackToDefense" })}
          >
            <span>基础攻击 −{amount}</span>
            <strong>转化为基础防御 +{amount}</strong>
            <small>{player.baseAttack < amount ? "基础攻击不足" : `${player.baseAttack} → ${player.baseAttack - amount}`}</small>
          </button>
          <button
            type="button"
            disabled={playing || player.baseDefense < amount}
            onClick={() => dispatch({ type: "chooseMapEventHarmony", option: "defenseToAttack" })}
          >
            <span>基础防御 −{amount}</span>
            <strong>转化为基础攻击 +{amount}</strong>
            <small>{player.baseDefense < amount ? "基础防御不足" : `${player.baseDefense} → ${player.baseDefense - amount}`}</small>
          </button>
          <button
            type="button"
            className="discard-equipment"
            disabled={playing}
            onClick={() => dispatch({ type: "chooseMapEventHarmony", option: "decline" })}
          >
            <span>不转换属性</span>
            <strong>放弃调和</strong>
            <small>保持当前基础攻击与基础防御。</small>
          </button>
        </div>
      }
    />
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
      waiting={<p className="waiting-notice">{`等待${loser.name}选择代价……`}</p>}
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

export function BlessingChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: BlessingChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const winner = state.players[choice.winnerId];
  const loser = choice.source === "pvp" ? state.players[choice.loserId] : undefined;
  const offeredDefinition = blessingDefinition(choice.offered.kind);
  const capacity = blessingCapacity(winner);
  const canChoose = viewerSeat === choice.winnerId;

  return (
    <DecisionModal
      className="blessing-choice-modal"
      kicker="赐福抉择"
      title={choice.source === "pvp"
        ? `${winner.name}夺得了${loser!.name}的赐福`
        : `${winner.name}在${choice.tileLabel}发现新的赐福`}
      lead={`当前赐福槽位 ${winner.blessings.length}/${capacity}。接纳新赐福时，被替换的赐福会永久消失。`}
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${winner.name}选择赐福……`}</p>}
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
              <small><RuleText text={definition.description} /></small>
            </div>
          );
        })}
        <div className="offered">
          <span>{choice.source === "pvp" ? "败方赐福" : "新赐福"}</span>
          <strong>{offeredDefinition.name}</strong>
          <small><RuleText text={offeredDefinition.description} /></small>
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
      lead={<CardBlurb keywords={scrollKeywords(definition)} description={definition.description} />}
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}选择目标……`}</p>}
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

export function ScrollDiscardChoicePanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: ScrollDiscardChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
}) {
  const target = state.players[choice.targetPlayerId];
  const candidates = visibleScrolls(target.scrolls).filter((scroll) =>
    choice.candidateIds.includes(scroll.instanceId)
  );
  const canChoose = viewerSeat === choice.targetPlayerId;

  return (
    <DecisionModal
      className="equipment-choice-modal"
      kicker={choice.scrollName}
      title={`${target.name}选择要弃掉的卷轴`}
      lead="被缴械的玩家自行决定损失哪一张暗牌。"
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${target.name}选择弃牌……`}</p>}
      actions={
        <div className="equipment-choice-options">
          {candidates.map((scroll) => {
            const definition = SCROLLS[scroll.kind];
            return (
              <button
                type="button"
                key={scroll.instanceId}
                disabled={playing}
                onClick={() => dispatch({
                  type: "chooseScrollDiscard",
                  instanceId: scroll.instanceId,
                })}
              >
                <span>弃掉</span>
                <strong>{definition.name}</strong>
                <small>
                  <CardBlurb
                    keywords={scrollKeywords(definition)}
                    description={definition.description}
                  />
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
      waiting={<p className="waiting-notice">{`等待${challenger.name}选择对手……`}</p>}
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
    <DecisionModal
      className="equipment-choice-modal"
      kicker="装备槽已满"
      title={`${player.name}获得了${definition.name}`}
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}选择装备……`}</p>}
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
                <small>
                  <CardBlurb
                    keywords={equipmentKeywords(EQUIPMENT[item.kind])}
                    description={EQUIPMENT[item.kind].description}
                  />
                </small>
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
        <p>
          <CardBlurb
            keywords={equipmentKeywords(definition)}
            description={definition.description}
          />
        </p>
      </div>
    </DecisionModal>
  );
}

export function StatGrowthPanel({ state, choice, dispatch, playing, viewerSeat }: {
  state: GameStateView;
  choice: StatGrowthChoiceState;
  dispatch: Dispatch;
  playing: boolean;
  viewerSeat: PlayerId;
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
      kicker={region ? `${region.name}·登顶之证` : "登顶之证"}
      title={`${player.name}的永久成长`}
      lead="击败阶段首领的奖赏，一局只有两次，选定后不可更改。"
      canAct={canChoose}
      waiting={<p className="waiting-notice">{`等待${player.name}分配成长……`}</p>}
      actions={
        <div className="stat-growth-options">
          {STAT_GROWTH_OPTIONS.map((option) => (
            <button
              key={option}
              disabled={playing}
              onClick={() => dispatch({ type: "chooseStatGrowth", option })}
            >
              <strong>{STAT_GROWTH[option].name}</strong>
              <small><RuleText text={STAT_GROWTH[option].description} /></small>
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
