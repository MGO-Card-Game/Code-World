/** 稀有度由低到高：普通、稀有、史诗、传说。 */
export type CardRarity = "N" | "R" | "SR" | "PR";

/**
 * 抽取权重。键的顺序就是由低到高的档位顺序，抽取时按这个顺序走票。
 *
 * 权重和为 100，但只有每一档都至少有一张卡时，这四个数字才等于实际概率——
 * 空档不参加抽取，它的权重会被剩下的档位按比例分掉（见 pickByRarity）。
 */
export const CARD_RARITY_WEIGHTS: Record<CardRarity, number> = {
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
  if (items.length === 0) throw new Error("不能从空卡池抽取内容");
  const rarities = CARD_RARITY_ORDER
    .filter((rarity) => items.some((item) => rarityOf(item) === rarity));
  const totalWeight = rarities.reduce(
    (sum, rarity) => sum + CARD_RARITY_WEIGHTS[rarity],
    0,
  );
  let ticket = Math.min(0.999999999, Math.max(0, random())) * totalWeight;
  let selectedRarity = rarities.at(-1)!;
  for (const rarity of rarities) {
    ticket -= CARD_RARITY_WEIGHTS[rarity];
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
