import { describe, expect, it } from "vitest";
import {
  CARD_RARITY_ORDER,
  CARD_RARITY_WEIGHTS,
  REWARD_RARITY_TIERS,
  pickByRarity,
  pickByRarityWithWeights,
  type CardRarity,
} from "./rarity";

/** 依次返回预设值的 random，用来精确落在某个票位上 */
function sequence(...values: number[]) {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

const rarityOf = (item: { rarity: CardRarity }) => item.rarity;

/** 每档一张卡，卡名就是档位，方便直接断言抽中了哪一档 */
const FULL_POOL = CARD_RARITY_ORDER.map((rarity) => ({ rarity }));

describe("稀有度", () => {
  it("四档权重合计 100，键序即由低到高", () => {
    expect(CARD_RARITY_WEIGHTS).toEqual({ N: 50, R: 30, SR: 15, PR: 5 });
    expect(CARD_RARITY_ORDER).toEqual(["N", "R", "SR", "PR"]);

    const total = CARD_RARITY_ORDER.reduce(
      (sum, rarity) => sum + CARD_RARITY_WEIGHTS[rarity],
      0,
    );
    expect(total).toBe(100);
  });

  it("奖励品质分为 basic / standard / premium 三档，可供不同来源复用", () => {
    expect(REWARD_RARITY_TIERS).toEqual({
      basic: { N: 80, R: 15, SR: 5, PR: 0 },
      standard: { N: 50, R: 30, SR: 15, PR: 5 },
      premium: { N: 40, R: 30, SR: 20, PR: 10 },
    });
    for (const weights of Object.values(REWARD_RARITY_TIERS)) {
      expect(Object.values(weights).reduce<number>((sum, weight) => sum + weight, 0)).toBe(100);
    }
    expect(CARD_RARITY_WEIGHTS).toBe(REWARD_RARITY_TIERS.standard);
  });

  it("每档都有卡时，票位边界正好落在声明的百分比上", () => {
    // 权重和为 100，票位就是百分比：[0,50) N、[50,80) R、[80,95) SR、[95,100) PR
    const at = (percent: number) =>
      pickByRarity(FULL_POOL, rarityOf, sequence(percent / 100, 0)).rarity;

    expect(at(0)).toBe("N");
    expect(at(49.9)).toBe("N");
    expect(at(50)).toBe("R");
    expect(at(79.9)).toBe("R");
    expect(at(80)).toBe("SR");
    expect(at(94.9)).toBe("SR");
    expect(at(95)).toBe("PR");
    expect(at(99.9)).toBe("PR");
  });

  it("空档不参加抽取，权重由剩下的档位按比例承接", () => {
    // 去掉 PR，总权重变 95，PR 的 5 点分给前三档而不是落空
    const noPr = FULL_POOL.filter((item) => item.rarity !== "PR");
    const at = (fraction: number) =>
      pickByRarity(noPr, rarityOf, sequence(fraction, 0)).rarity;

    // 票位 0.99 * 95 = 94.05，仍落在 SR 段（50+30+15 = 95）
    expect(at(0.99)).toBe("SR");
    expect(at(0)).toBe("N");
    // 50/95 ≈ 52.6%，N 的实际概率被抬高了，这正是"按比例承接"的意思
    expect(at(0.52)).toBe("N");
    expect(at(0.53)).toBe("R");
  });

  it("random 返回 1 也不会越界", () => {
    // 上游的 nextRandom 理论上取不到 1，但兜底不能塌
    expect(pickByRarity(FULL_POOL, rarityOf, sequence(1, 1)).rarity).toBe("PR");
  });

  it("空卡池直接报错，不返回 undefined", () => {
    expect(() => pickByRarity([], rarityOf, sequence(0))).toThrow("不能从空卡池抽取内容");
  });

  it("调用方可以提供独立权重而不改全局卡池", () => {
    const highQuality = { N: 20, R: 50, SR: 25, PR: 5 } as const;
    const at = (fraction: number) =>
      pickByRarityWithWeights(FULL_POOL, rarityOf, highQuality, sequence(fraction, 0)).rarity;

    expect(at(0.19)).toBe("N");
    expect(at(0.2)).toBe("R");
    expect(at(0.7)).toBe("SR");
    expect(at(0.95)).toBe("PR");
  });
});
