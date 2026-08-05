export type CardRarity = "N" | "R" | "SR";

export const CARD_RARITY_WEIGHTS: Record<CardRarity, number> = {
  N: 70,
  R: 25,
  SR: 5,
};

/** 先按稀有度抽取，再在该稀有度的内容中等概率抽取。 */
export function pickByRarity<T>(
  items: readonly T[],
  rarityOf: (item: T) => CardRarity,
  random: () => number,
): T {
  if (items.length === 0) throw new Error("不能从空卡池抽取内容");
  const rarities = (Object.keys(CARD_RARITY_WEIGHTS) as CardRarity[])
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
