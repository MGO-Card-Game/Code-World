import { describe, expect, it } from "vitest";
import {
  SCROLL_CATEGORY_NAMES,
  SCROLL_CATEGORY_SIGILS,
  SCROLLS,
  SCROLLS_BY_GROUP,
  scrollCategory,
  type ScrollKind,
} from "./index";

const ALL_KINDS = Object.keys(SCROLLS) as ScrollKind[];

describe("卷轴主题表", () => {
  it("合并后不丢卡——主题表之间不能有重名的 kind", () => {
    const partsTotal = Object.values(SCROLLS_BY_GROUP)
      .reduce((sum, group) => sum + Object.keys(group).length, 0);
    expect(ALL_KINDS).toHaveLength(partsTotal);
  });

  it("主题分组与攻防类型是两个维度，不该互相绑定", () => {
    // 攻防转换组里既有只能攻的力量卷轴，也有只能防的护盾卷轴和铁壁令
    const swingCategories = new Set(
      Object.keys(SCROLLS_BY_GROUP.combatSwing)
        .map((kind) => scrollCategory(SCROLLS[kind as ScrollKind])),
    );
    expect(swingCategories.size).toBeGreaterThan(1);
  });
});

describe("卡牌类型", () => {
  it("由 timings 推导，不再单独配置", () => {
    expect(scrollCategory(SCROLLS.might)).toBe("attack");
    expect(scrollCategory(SCROLLS.ironWallOrder)).toBe("defense");
    expect(scrollCategory(SCROLLS.fate)).toBe("universal");
    expect(scrollCategory(SCROLLS.firstAidBandage)).toBe("healing");
    // 巨龙打击攻防都能打，牌名里没有"通"字，类型仍然是通用
    expect(scrollCategory(SCROLLS.dragonStrike)).toBe("universal");
  });

  it("每张牌都落得进四类里，牌面圆圈不会开天窗", () => {
    for (const kind of ALL_KINDS) {
      const category = scrollCategory(SCROLLS[kind]);
      expect(SCROLL_CATEGORY_SIGILS[category]).toMatch(/^[攻防通疗]$/);
      expect(SCROLL_CATEGORY_NAMES[category]).toBeTruthy();
    }
  });

  it("圆圈里的字就是类型名的首字", () => {
    for (const category of ["attack", "defense", "universal", "healing"] as const) {
      expect(SCROLL_CATEGORY_SIGILS[category]).toBe(SCROLL_CATEGORY_NAMES[category][0]);
    }
  });
});
