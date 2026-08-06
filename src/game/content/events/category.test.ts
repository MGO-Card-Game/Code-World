import { describe, expect, it } from "vitest";
import { MAP_EVENTS, mapEventPool, pickMapEvent } from ".";
import type { MapRegionId } from "../../types";

const REGIONS: MapRegionId[] = ["foothill", "mountainside", "summit"];

describe("地图事件内容注册表", () => {
  it("当前三类事件都由对应分类文件盖章", () => {
    expect(Object.keys(MAP_EVENTS)).toEqual([
      "roadsideRespite",
      "fallingRocks",
      "travelerGift",
    ]);
    expect(MAP_EVENTS.roadsideRespite.category).toBe("recovery");
    expect(MAP_EVENTS.fallingRocks.category).toBe("hazard");
    expect(MAP_EVENTS.travelerGift.category).toBe("reward");
  });

  it("每个区域都有合法事件池，当前三个事件保持等概率", () => {
    for (const region of REGIONS) {
      expect(mapEventPool(region)).toEqual([
        ["roadsideRespite", 1],
        ["fallingRocks", 1],
        ["travelerGift", 1],
      ]);
    }
  });

  it("一次权重抽取消耗一个随机数并覆盖三个事件区间", () => {
    let calls = 0;
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.1; }))
      .toBe("roadsideRespite");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.4; }))
      .toBe("fallingRocks");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.8; }))
      .toBe("travelerGift");
    expect(calls).toBe(3);
  });

  it("所有事件都具备展示信息、正权重和至少一个声明式效果", () => {
    for (const definition of Object.values(MAP_EVENTS)) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.effects.length).toBeGreaterThan(0);
      for (const weight of Object.values(definition.regions)) {
        expect(weight).toBeGreaterThan(0);
      }
    }
  });
});
