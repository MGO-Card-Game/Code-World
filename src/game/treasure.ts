import { bonusTreasureEquipment } from "./blessings";
import { pickEquipmentKind } from "./content/equipment";
import { REWARD_RARITY_TIERS, type RewardRarityTier } from "./content/rarity";
import { pickWeighted } from "./content/weighted";
import { ECONOMY, grantGold } from "./economy";
import { grantEquipment, grantScroll, rewardSecret, type Reward } from "./resources";
import { grantTreasureEquipmentReward } from "./rewards";
import { addHistory, nextRandom, rollDie } from "./state";
import type {
  EquipmentChoiceState,
  GameState,
  MapTile,
  Player,
  TreasureRewardNoticeState,
} from "./types";

/**
 * 开宝箱。
 *
 * 宝箱不是一次性的：同一个箱子可以反复开，节流靠「有一定概率是空的」，
 * 而不是开过一次就永久锁死。和赌场同一个形状——一张结果权重表，空箱就是
 * 表里的一档，所以不需要在发奖之前另跑一条概率判定。
 *
 * 品质则绑在「是不是第一次从这个箱子里拿到东西」上：首次走 standard，之后走
 * meager。首次踩到宝箱的手感和以前一样，而绕圈反复刷同一个箱子拿不到 PR——
 * meager 的 PR 权重是 0，这不是概率低，是结构上够不着。普通怪走的 basic 仍
 * 留着 1% 爆冷，所以「打赢一场」和「空手刷一个箱子」不是同一件事。
 */

type TreasureOutcome = "empty" | "gold" | "scroll" | "equipment" | "combo";

/**
 * 一次开箱的结果权重。
 *
 * 空箱占最大一档，它同时承担了「反复刷同一个箱子」的节流。金币与物品是平行的
 * 两类产出，combo 是两者同时给的小概率档——把它单列出来，是为了让「开出一大票」
 * 成为可感知的少数事件，而不是把金币摊进每一次开箱里变成背景噪音。
 */
export const TREASURE_OUTCOME_WEIGHTS: readonly (readonly [TreasureOutcome, number])[] = [
  ["empty", 30],
  ["gold", 25],
  ["scroll", 15],
  ["equipment", 15],
  ["combo", 15],
];

export function openTreasure(state: GameState, player: Player, tile: MapTile) {
  const progress = player.stageProgress[tile.region];
  const notice: TreasureRewardNoticeState = {
    playerId: player.id,
    tileLabel: tile.label,
    empty: false,
    rewards: [],
    revealAfterEventId: state.lastEvents.at(-1)?.id,
  };
  // 空箱不算「开出过东西」，第一次踩空不该把 standard 那一次手感烧掉
  const firstHaul = !progress.openedTreasureTileIds.includes(tile.id);
  const outcome = pickWeighted(TREASURE_OUTCOME_WEIGHTS, () => nextRandom(state));

  if (outcome === "empty") {
    notice.empty = true;
    addHistory(state, `${player.name}翻遍「${tile.label}」，这一趟什么都没剩下。`);
    state.phase = { kind: "treasureReward", notice };
    return;
  }

  if (firstHaul) progress.openedTreasureTileIds.push(tile.id);
  // 记档位名而不是权重对象：它要跟着 resume 存进 GameState 并广播给各端
  const tier: RewardRarityTier = firstHaul ? "standard" : "meager";
  const rarityWeights = REWARD_RARITY_TIERS[tier];

  const gold = outcome === "gold" || outcome === "combo"
    ? grantGold(state, player, ECONOMY.treasureGold, "treasure")
    : 0;
  if (gold > 0) {
    notice.rewards.push({
      source: "treasure",
      resourceType: "gold",
      name: `${gold} 金币`,
      publicName: `${gold} 金币`,
    });
  }
  // combo 的物品部分和纯物品档走同一条路：卷轴、装备各半
  const item = outcome === "combo"
    ? (rollDie(state, 2) === 1 ? "scroll" : "equipment")
    : outcome === "gold" ? undefined : outcome;

  const bonusEquipment = bonusTreasureEquipment(player);
  const resume: EquipmentChoiceState["resume"] = bonusEquipment > 0
    ? { kind: "continueTreasureReward", remaining: bonusEquipment, tier, notice }
    : { kind: "showTreasureReward", notice };

  let reward: Reward | undefined;
  if (item === "scroll") {
    reward = grantScroll(state, player, undefined, rarityWeights);
  } else if (item === "equipment") {
    reward = grantEquipment(
      state,
      player,
      pickEquipmentKind(() => nextRandom(state), { rarityWeights }),
      resume,
    );
  }
  if (reward) {
    notice.rewards.push({
      source: "treasure",
      resourceType: reward.resourceType,
      name: reward.name,
      publicName: reward.publicName,
    });
  }

  announceHaul(state, player, tile, gold, reward);

  // 装备槽满时 grantEquipment 已经把阶段切成 equipmentChoice，后续由 resume 接手
  if (!reward?.pendingEquipmentChoice) {
    if (bonusEquipment > 0) {
      grantTreasureEquipmentReward(state, player, bonusEquipment, tier, notice);
    } else {
      state.phase = { kind: "treasureReward", notice };
    }
  }
}

/** 金币和物品可能只有一样，也可能都有；卷轴对旁观者始终只是「一张卷轴」。 */
function announceHaul(
  state: GameState,
  player: Player,
  tile: MapTile,
  gold: number,
  reward: Reward | undefined,
) {
  const goldText = gold > 0 ? `${gold} 金币` : undefined;
  const line = (what: string) => `${player.name}打开「${tile.label}」，获得${what}。`;
  if (!reward) {
    addHistory(state, line(goldText!));
    return;
  }
  const join = (rewardName: string) =>
    goldText ? `${rewardName}和${goldText}` : rewardName;
  const combined = { name: join(reward.name), publicName: join(reward.publicName) };
  addHistory(state, line(combined.name), rewardSecret(player, line, combined));
}
