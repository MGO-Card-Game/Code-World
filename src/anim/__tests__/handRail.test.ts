import { describe, expect, it } from "vitest";
import {
  RAIL_CARD_WIDTH,
  RAIL_MIN_VISIBLE,
  RAIL_WIDTH,
  railMetrics,
  railSelectionGap,
} from "../handRail";

const visible = (count: number) => RAIL_CARD_WIDTH + railMetrics(count).spacing;

describe("手牌浏览栏排布", () => {
  it("排得下时留白，不重叠也不滚动", () => {
    for (let count = 1; count <= 6; count += 1) {
      const metrics = railMetrics(count);
      expect(metrics.spacing).toBeGreaterThanOrEqual(0);
      expect(metrics.scrollable).toBe(false);
      expect(metrics.width).toBeLessThanOrEqual(RAIL_WIDTH);
    }
  });

  it("排不下时先转为重叠，仍然不滚动", () => {
    for (let count = 7; count <= 11; count += 1) {
      const metrics = railMetrics(count);
      expect(metrics.spacing).toBeLessThan(0);
      expect(metrics.scrollable).toBe(false);
      expect(metrics.width).toBeLessThanOrEqual(RAIL_WIDTH + 0.001);
    }
  });

  it("每张牌永远露出可辨识的一条边，不会被压成细条", () => {
    for (let count = 1; count <= 80; count += 1) {
      expect(visible(count)).toBeGreaterThanOrEqual(RAIL_MIN_VISIBLE);
    }
  });

  it("收紧到下限后改用横向滚动，而不是继续压缩", () => {
    const metrics = railMetrics(12);
    expect(metrics.scrollable).toBe(true);
    expect(visible(12)).toBe(RAIL_MIN_VISIBLE);
    // 再多也只是变长，单张宽度不再变
    expect(visible(40)).toBe(RAIL_MIN_VISIBLE);
    expect(railMetrics(40).width).toBeGreaterThan(metrics.width);
  });

  it("张数增加时间距单调收紧", () => {
    for (let count = 2; count < 40; count += 1) {
      expect(railMetrics(count + 1).spacing).toBeLessThanOrEqual(railMetrics(count).spacing);
    }
  });

  it("单张牌不留间距也不滚动", () => {
    expect(railMetrics(1)).toEqual({ spacing: 0, scrollable: false, width: RAIL_CARD_WIDTH });
    expect(railMetrics(0)).toEqual({ spacing: 0, scrollable: false, width: 0 });
  });

  it("重叠时选中卡左右让位，不重叠时不让", () => {
    expect(railSelectionGap(railMetrics(4).spacing)).toBe(0);
    expect(railSelectionGap(railMetrics(9).spacing)).toBeGreaterThan(0);
    // 让开的正好是被压住的那部分，选中卡因此完整露出
    const spacing = railMetrics(9).spacing;
    expect(RAIL_CARD_WIDTH + spacing + railSelectionGap(spacing)).toBe(RAIL_CARD_WIDTH);
  });
});
