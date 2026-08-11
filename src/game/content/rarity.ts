/** 稀有度由低到高：普通、稀有、史诗、传说。 */
export type CardRarity = "N" | "R" | "SR" | "PR";
export type RarityWeights = Readonly<Record<CardRarity, number>>;

/**
 * 抽取权重。键的顺序就是由低到高的档位顺序，抽取时按这个顺序走票。
 *
 * 权重和为 100，但只有每一档都至少有一张卡时，这四个数字才等于实际概率——
 * 空档不参加抽取，它的权重会被剩下的档位按比例分掉（见 pickByRarity）。
 */
/**
 * 可复用的奖励品质分级。战斗、宝箱和事件只选择档位，不再各自复制四组数字。
 * basic 不产 PR；standard 是通用卡池；premium 提高 SR / PR 的出现率。
 */
export const REWARD_RARITY_TIERS = {
  basic: { N: 80, R: 15, SR: 5, PR: 0 },
  standard: { N: 50, R: 30, SR: 15, PR: 5 },
  premium: { N: 40, R: 30, SR: 20, PR: 10 },
} as const satisfies Record<string, RarityWeights>;

export type RewardRarityTier = keyof typeof REWARD_RARITY_TIERS;

/** 卷轴及未指定档位的装备继续使用通用档。 */
export const CARD_RARITY_WEIGHTS: RarityWeights = REWARD_RARITY_TIERS.standard;

/** 由低到高的档位顺序，用于展示排序与「不低于某档」这类判断。 */
export const CARD_RARITY_ORDER = Object.keys(CARD_RARITY_WEIGHTS) as CardRarity[];

/**
 * 把低于地板档的权重清零，用来表达「必出 R 及以上」这类保底。
 *
 * 做成权重变换而不是抽完再重抽，是因为重抽会多消耗随机数，按种子重放时
 * 同一局会走出不同的牌序。清零之后剩余档位由 pickByRarityWithWeights 按
 * 原有比例归一化，档位之间的相对关系不变——保底只是砍掉下限，不重新配平。
 */
export function withRarityFloor(
  weights: RarityWeights,
  floor: CardRarity,
): RarityWeights {
  const floorIndex = CARD_RARITY_ORDER.indexOf(floor);
  return Object.fromEntries(
    CARD_RARITY_ORDER.map((rarity, index) => [
      rarity,
      index < floorIndex ? 0 : weights[rarity],
    ]),
  ) as RarityWeights;
}

/** 先按稀有度抽取，再在该稀有度的内容中等概率抽取。 */
export function pickByRarity<T>(
  items: readonly T[],
  rarityOf: (item: T) => CardRarity,
  random: () => number,
): T {
  return pickByRarityWithWeights(items, rarityOf, CARD_RARITY_WEIGHTS, random);
}

/** 使用调用方给出的稀有度权重；事件奖励可以借此偏向高品质而不改全局卡池。 */
export function pickByRarityWithWeights<T>(
  items: readonly T[],
  rarityOf: (item: T) => CardRarity,
  weights: RarityWeights,
  random: () => number,
): T {
  if (items.length === 0) throw new Error("不能从空卡池抽取内容");
  if (Object.values(weights).some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("稀有度权重必须是有限的非负数");
  }
  const rarities = CARD_RARITY_ORDER
    .filter((rarity) => weights[rarity] > 0 && items.some((item) => rarityOf(item) === rarity));
  if (rarities.length === 0) throw new Error("卡池没有权重大于 0 的稀有度");
  const totalWeight = rarities.reduce(
    (sum, rarity) => sum + weights[rarity],
    0,
  );
  let ticket = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
  let selectedRarity = rarities.at(-1)!;
  for (const rarity of rarities) {
    ticket -= weights[rarity];
    if (ticket < 0) {
      selectedRarity = rarity;
      break;
    }
  }

  const pool = items.filter((item) => rarityOf(item) === selectedRarity);
  const index = Math.min(
    pool.length - 1,
    Math.floor(Math.max(0, random()) * pool.length),
  );
  return pool[index];
}
