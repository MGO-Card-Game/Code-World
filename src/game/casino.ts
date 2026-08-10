import { pickWeighted } from "./content/weighted";
import { grantGold, roundGold, spendGold } from "./economy";
import { applyStatGrowth, STAT_GROWTH, STAT_GROWTH_OPTIONS } from "./growth";
import { grantEquipment, grantScroll, rewardSecret } from "./resources";
import { addHistory, nextRandom } from "./state";
import type { CasinoState, GameState } from "./types";

/**
 * 赌场转盘：花钱赌一次随机结果，价格随游玩次数递增。
 *
 * 和商店格共享“进店后反复花钱、主动离场”的形状，但赌场没有货架——
 * 每一次转动都是当场现抽，不存在“这次进店能看见什么”这件事。
 */

export const CASINO_PRICES = {
  /**
   * 头奖（基础属性强化）不计入商店的 statPurchases 计数器，价格递增只靠赌场
   * 自己这一条曲线兜底，所以基价和涨幅都比早期设想的更高，避免头奖被刷成
   * 廉价的无限属性刷取。
   */
  base: 80,
  multiplier: 1.6,
  /** 中金币档的赔率；乘在“本次价格”上，赢面比本金明显但不到翻倍。 */
  goldPayoutMultiplier: 1.5,
} as const;

export function casinoSpinPrice(spins: number) {
  const played = Math.max(0, Math.floor(spins));
  return roundGold(CASINO_PRICES.base * CASINO_PRICES.multiplier ** played);
}

type CasinoOutcome = "bust" | "gold" | "scroll" | "equipment" | "statGrowth";

/**
 * 五档结果的相对权重。
 *
 * 空手而归占大头，让“转了却什么都没有”成为真实存在的风险；卷轴/装备沿用
 * 其它渠道的稀有度权重；基础属性强化是头奖，概率压到很低——它是永久成长，
 * 不该被赌场刷成比阶段首领奖励更容易拿到的常规产出。
 */
const CASINO_OUTCOME_WEIGHTS: readonly (readonly [CasinoOutcome, number])[] = [
  ["bust", 30],
  ["gold", 25],
  ["scroll", 25],
  ["equipment", 15],
  ["statGrowth", 5],
];

export function spinCasino(state: GameState): boolean {
  if (state.phase.kind !== "casino") return false;
  const casino = state.phase.casino;
  if (casino.result) return false;
  const player = state.players[casino.playerId];
  if (!player || player.position !== casino.tileIndex) return false;

  const price = casinoSpinPrice(casino.spins);
  if (!spendGold(state, player, price, "event")) return false;

  // 价格和次数在发奖之前先落定：装备槽满会把 phase 切去 equipmentChoice，
  // 回来时必须已经是转动之后的这一份 casino 状态，不能重复扣费或漏记次数。
  const nextCasino: CasinoState = { ...casino, spins: casino.spins + 1 };
  state.phase = { kind: "casino", casino: nextCasino };

  const outcome = pickWeighted(CASINO_OUTCOME_WEIGHTS, () => nextRandom(state));
  switch (outcome) {
    case "bust":
      nextCasino.result = { kind: "bust", price };
      addHistory(state, `${player.name}花费 ${price} 金币转动轮盘，指针停在空格，一无所获。`);
      return true;
    case "gold": {
      const amount = grantGold(
        state,
        player,
        roundGold(price * CASINO_PRICES.goldPayoutMultiplier),
        "event",
      );
      nextCasino.result = { kind: "gold", price, amount };
      addHistory(state, `${player.name}花费 ${price} 金币转动轮盘，中了 ${amount} 金币。`);
      return true;
    }
    case "scroll": {
      const reward = grantScroll(state, player);
      nextCasino.result = {
        kind: "scroll",
        price,
        name: reward.name,
        publicName: reward.publicName,
      };
      const line = (rewardName: string) =>
        `${player.name}花费 ${price} 金币转动轮盘，获得${rewardName}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return true;
    }
    case "equipment": {
      const reward = grantEquipment(state, player, undefined, { kind: "casino", casino: nextCasino });
      nextCasino.result = { kind: "equipment", price, name: reward.name };
      const line = (rewardName: string) =>
        `${player.name}花费 ${price} 金币转动轮盘，获得${rewardName}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return true;
    }
    case "statGrowth": {
      const option = STAT_GROWTH_OPTIONS[Math.floor(nextRandom(state) * STAT_GROWTH_OPTIONS.length)];
      applyStatGrowth(state, player, option);
      nextCasino.result = { kind: "statGrowth", price, option };
      addHistory(
        state,
        `${player.name}花费 ${price} 金币转动轮盘，转出头奖：${STAT_GROWTH[option].name}！`,
      );
      return true;
    }
  }
}

export function acknowledgeCasinoResult(state: GameState): boolean {
  if (state.phase.kind !== "casino" || !state.phase.casino.result) return false;
  const { result: _result, ...casino } = state.phase.casino;
  state.phase = { kind: "casino", casino };
  return true;
}

export function leaveCasino(state: GameState): boolean {
  if (state.phase.kind !== "casino") return false;
  if (state.phase.casino.result) return false;
  const player = state.players[state.phase.casino.playerId];
  if (!player) return false;
  state.phase = { kind: "turnComplete" };
  addHistory(state, `${player.name}离开了赌场。`);
  return true;
}
