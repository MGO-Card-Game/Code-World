/**
 * 稀有度由低到高：普通、稀有、史诗、传说。
 *
 * 这个数组就是「由低到高」的唯一定义：抽取时按它走票，展示排序和
 * 「不低于某档」这类判断也都读它。CardRarity 由它推导，两者不会各说各话。
 */
export const CARD_RARITY_ORDER = ["N", "R", "SR", "PR"] as const;
export type CardRarity = (typeof CARD_RARITY_ORDER)[number];
export type RarityWeights = Readonly<Record<CardRarity, number>>;

/**
 * 可复用的奖励品质分级。**所有成组的稀有度权重都在这张表里**，调用方只选档位名，
 * 不再各自抄一份四个数字。
 *
 * 权重和为 100，但只有每一档都至少有一张卡时，这四个数字才等于实际概率——
 * 空档不参加抽取，它的权重会被剩下的档位按比例分掉（见 pickByRarity）。
 *
 * 前四档是一条由低到高的梯子：
 * - meager   唯一 PR 权重为 0 的一档，留给可以反复刷的来源——那里出顶级装备
 *            不该是概率低，而该是结构上拿不到
 * - basic    起保留 1% 的 PR 作为爆冷
 * - standard 通用卡池，不指定档位时的默认值
 * - premium  提高 SR / PR 的出现率
 *
 * highQuality 不是 premium 之上的又一级，而是另一种形状：牺牲 PR 换取压倒性的
 * R，用在「保证给一件像样的东西」的场合（石中武器）。放进同一张表是因为它同样
 * 是一组四个数字，散在别处只会让「改品质要去哪里找」多一个答案。
 */
export const REWARD_RARITY_TIERS = {
  meager: { N: 85, R: 10, SR: 5, PR: 0 },
  basic: { N: 80, R: 15, SR: 4, PR: 1 },
  standard: { N: 50, R: 30, SR: 15, PR: 5 },
  premium: { N: 40, R: 30, SR: 20, PR: 10 },
  highQuality: { N: 20, R: 50, SR: 25, PR: 5 },
} as const satisfies Record<string, RarityWeights>;

export type RewardRarityTier = keyof typeof REWARD_RARITY_TIERS;

/** 不指定档位时用的通用档。 */
export const DEFAULT_RARITY_TIER: RewardRarityTier = "standard";

/**
 * 把低于地板档的权重清零，用来表达「必出 R 及以上」这类保底。
 *
 * 做成权重变换而不是抽完再重抽，是因为重抽会多消耗随机数，按种子重放时
 * 同一局会走出不同的牌序。清零之后剩余档位由 pickByRarity 按原有比例归一化，
 * 档位之间的相对关系不变——保底只是砍掉下限，不重新配平。
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

/**
 * 先按稀有度抽档，再在该档的内容中等概率抽取。固定消耗两个随机数。
 *
 * 权重可省略；省略时用通用档。装备、卷轴、精英词条走的都是这一条通路，
 * 边界处理和随机数消耗量因此不会在不同内容池之间悄悄分叉。
 */
export function pickByRarity<T>(
  items: readonly T[],
  rarityOf: (item: T) => CardRarity,
  random: () => number,
  weights: RarityWeights = REWARD_RARITY_TIERS[DEFAULT_RARITY_TIER],
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
