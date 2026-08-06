/** 稀有度由低到高：普通、稀有、史诗、传说。 */
export type CardRarity = "N" | "R" | "SR" | "PR";
export type RarityWeights = Readonly<Record<CardRarity, number>>;

/**
 * 抽取权重。键的顺序就是由低到高的档位顺序，抽取时按这个顺序走票。
 *
 * 权重和为 100，但只有每一档都至少有一张卡时，这四个数字才等于实际概率——
 * 空档不参加抽取，它的权重会被剩下的档位按比例分掉（见 pickByRarity）。
 */
export const CARD_RARITY_WEIGHTS: RarityWeights = {
  N: 50,
  R: 30,
  SR: 15,
  PR: 5,
};

/** 由低到高的档位顺序，用于展示排序与「不低于某档」这类判断。 */
export const CARD_RARITY_ORDER = Object.keys(CARD_RARITY_WEIGHTS) as CardRarity[];

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
