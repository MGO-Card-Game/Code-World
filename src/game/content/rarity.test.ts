import { describe, expect, it } from "vitest";
import {
  CARD_RARITY_ORDER,
  DEFAULT_RARITY_TIER,
  REWARD_RARITY_TIERS,
  pickByRarity,
  withRarityFloor,
  type CardRarity,
  type RarityWeights,
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
  it("稀有度顺序由低到高，是唯一一份定义", () => {
    expect(CARD_RARITY_ORDER).toEqual(["N", "R", "SR", "PR"]);
  });

  it("每一组稀有度权重都在档位表里，且各自合计 100", () => {
    expect(REWARD_RARITY_TIERS).toEqual({
      meager: { N: 85, R: 10, SR: 5, PR: 0 },
      basic: { N: 80, R: 15, SR: 4, PR: 1 },
      standard: { N: 50, R: 30, SR: 15, PR: 5 },
      premium: { N: 40, R: 30, SR: 20, PR: 10 },
      highQuality: { N: 20, R: 50, SR: 25, PR: 5 },
    });
    for (const [tier, weights] of Object.entries(REWARD_RARITY_TIERS)) {
      const total = CARD_RARITY_ORDER.reduce((sum, rarity) => sum + weights[rarity], 0);
      expect(total, `${tier} 档权重合计不是 100`).toBe(100);
    }
    expect(REWARD_RARITY_TIERS[DEFAULT_RARITY_TIER]).toBe(REWARD_RARITY_TIERS.standard);
  });

  it("只有 meager 一档拿不到 PR，其余各档都留了爆冷的口子", () => {
    const withoutPr = Object.entries(REWARD_RARITY_TIERS)
      .filter(([, weights]) => weights.PR === 0)
      .map(([tier]) => tier);
    expect(withoutPr).toEqual(["meager"]);
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

  it("传入档位可以偏离通用档，省略时才落回通用档", () => {
    const at = (fraction: number) =>
      pickByRarity(
        FULL_POOL,
        rarityOf,
        sequence(fraction, 0),
        REWARD_RARITY_TIERS.highQuality,
      ).rarity;

    expect(at(0.19)).toBe("N");
    expect(at(0.2)).toBe("R");
    expect(at(0.7)).toBe("SR");
    expect(at(0.95)).toBe("PR");

    // 同一个票位，不传权重时按 standard 的边界走：0.2 还在 N 段里
    expect(pickByRarity(FULL_POOL, rarityOf, sequence(0.2, 0)).rarity).toBe("N");
  });
});

describe("保底档位", () => {
  it("低于地板的档位权重清零，地板本身与更高档保持原值", () => {
    expect(withRarityFloor(REWARD_RARITY_TIERS.premium, "R"))
      .toEqual({ N: 0, R: 30, SR: 20, PR: 10 });
    expect(withRarityFloor(REWARD_RARITY_TIERS.premium, "SR"))
      .toEqual({ N: 0, R: 0, SR: 20, PR: 10 });
    // 地板落在最低档等于没有保底
    expect(withRarityFloor(REWARD_RARITY_TIERS.premium, "N"))
      .toEqual(REWARD_RARITY_TIERS.premium);
  });

  it("保底之后无论摇出什么随机数，都抽不到低于地板的卡", () => {
    const floored = withRarityFloor(REWARD_RARITY_TIERS.premium, "SR");
    for (const fraction of [0, 0.01, 0.33, 0.5, 0.66, 0.99]) {
      const rarity = pickByRarity(
        FULL_POOL,
        rarityOf,
        sequence(fraction, 0),
        floored,
      ).rarity;
      expect(["SR", "PR"]).toContain(rarity);
    }
  });

  it("剩余档位按原比例归一化，保底不重新配平相对关系", () => {
    // premium 的 SR:PR = 20:10，清零后仍是 2:1，票位边界落在 2/3
    const floored = withRarityFloor(REWARD_RARITY_TIERS.premium, "SR");
    const at = (fraction: number) =>
      pickByRarity(FULL_POOL, rarityOf, sequence(fraction, 0), floored).rarity;

    expect(at(0.66)).toBe("SR");
    expect(at(0.67)).toBe("PR");
  });

  it("不改变随机数消耗量，同一颗种子的牌序不会因为保底而错位", () => {
    const counted = (weights: RarityWeights) => {
      let calls = 0;
      pickByRarity(FULL_POOL, rarityOf, () => {
        calls += 1;
        return 0.5;
      }, weights);
      return calls;
    };

    expect(counted(withRarityFloor(REWARD_RARITY_TIERS.premium, "SR")))
      .toBe(counted(REWARD_RARITY_TIERS.premium));
  });
});
