import { describe, expect, it } from "vitest";
import {
  HAND_CARD_WIDTH,
  HAND_LEGIBLE_MAX,
  HAND_MIN_VISIBLE,
  HAND_RAIL_WIDTH,
  handCardLayout,
  handSpacing,
  handWidth,
} from "../handLayout";

describe("手牌扇形排布", () => {
  it("张数少时留白，不做重叠", () => {
    expect(handSpacing(1)).toBe(0);
    expect(handSpacing(3)).toBeGreaterThan(0);
    expect(handSpacing(6)).toBeGreaterThan(0);
  });

  it("放不下时转为重叠", () => {
    expect(handSpacing(12)).toBeLessThan(0);
    expect(handSpacing(20)).toBeLessThan(0);
  });

  it("任意张数都不撑破手牌坞", () => {
    // 文档 23.2 不设手牌上限，这里把范围拉到远超实际可能的张数
    for (let count = 1; count <= 60; count += 1) {
      expect(handWidth(count)).toBeLessThanOrEqual(HAND_RAIL_WIDTH + 0.001);
    }
  });

  it("在可读张数内，每张都留出可辨识的一条边", () => {
    for (let count = 1; count <= HAND_LEGIBLE_MAX; count += 1) {
      const visible = HAND_CARD_WIDTH + handSpacing(count);
      expect(visible).toBeGreaterThanOrEqual(HAND_MIN_VISIBLE);
    }
  });

  it("超出可读张数后卡牌继续收窄，但绝不溢出", () => {
    // 两条约束在 47 张相撞，此时宽度约束优先——撑破布局比卡牌变细严重得多
    const visible = HAND_CARD_WIDTH + handSpacing(HAND_LEGIBLE_MAX + 1);
    expect(visible).toBeLessThan(HAND_MIN_VISIBLE);
    expect(visible).toBeGreaterThan(0);
    expect(handWidth(HAND_LEGIBLE_MAX + 1)).toBeLessThanOrEqual(HAND_RAIL_WIDTH + 0.001);
  });

  it("张数增加时间距单调收紧", () => {
    for (let count = 2; count < 40; count += 1) {
      expect(handSpacing(count + 1)).toBeLessThanOrEqual(handSpacing(count));
    }
  });

  it("单张牌不旋转也不抬升", () => {
    expect(handCardLayout(0, 1)).toEqual({ rotate: 0, lift: 0, zIndex: 0 });
  });

  it("扇形左右对称，中心不旋转", () => {
    const count = 5;
    const first = handCardLayout(0, count);
    const last = handCardLayout(count - 1, count);
    const center = handCardLayout(2, count);

    expect(first.rotate).toBeCloseTo(-last.rotate);
    expect(first.rotate).toBeLessThan(0);
    expect(center.rotate).toBeCloseTo(0);
    expect(center.lift).toBeCloseTo(0);
  });

  it("边缘牌抬得比中心牌高", () => {
    const count = 7;
    expect(handCardLayout(0, count).lift).toBeGreaterThan(handCardLayout(3, count).lift);
  });

  it("张角和抬升有上限，牌多了不会把扇形甩开", () => {
    for (let count = 2; count <= 60; count += 1) {
      for (let index = 0; index < count; index += 1) {
        const { rotate, lift } = handCardLayout(index, count);
        expect(Math.abs(rotate)).toBeLessThanOrEqual(13.001);
        expect(lift).toBeLessThanOrEqual(16.001);
        expect(lift).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("zIndex 递增，右边的牌压在左边的牌上", () => {
    const count = 6;
    for (let index = 1; index < count; index += 1) {
      expect(handCardLayout(index, count).zIndex).toBeGreaterThan(
        handCardLayout(index - 1, count).zIndex,
      );
    }
  });
});
