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

  it("独占型效果必须是卡上唯一的一条", () => {
    /*
      useMapScroll 是按效果类型分派的，命中哪一支就直接把整张牌交给它处理、
      随即返回。所以这几种效果的同伴会被**静默丢掉**——不报错、不掉日志，
      只是配的效果没生效。疗牌那一支有 supported 兜底（不认识的组合直接拒），
      这几支没有，只能在这里守。

      targetPlayer 还多一层理由：它会把结算停在选人阶段，排在它后面的效果
      连执行的机会都没有。
    */
    const EXCLUSIVE = [
      "chooseMovement",
      "teleport",
      "teleportAnywhere",
      "advanceTiles",
      "targetPlayer",
    ];

    let checked = 0;
    for (const kind of ALL_KINDS) {
      const effects = SCROLLS[kind].effects;
      const exclusive = effects.filter((effect) => EXCLUSIVE.includes(effect.type));
      if (exclusive.length === 0) continue;
      checked += 1;
      expect(
        effects.length,
        `${SCROLLS[kind].name}（${kind}）带了独占效果 ${exclusive[0].type}，`
          + "同一张牌上的其他效果会被静默丢掉",
      ).toBe(1);
    }
    // 一张都没查到的话这条断言等于没跑
    expect(checked).toBeGreaterThan(0);
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
