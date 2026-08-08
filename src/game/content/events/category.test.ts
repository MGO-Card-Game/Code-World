import { describe, expect, it } from "vitest";
import { MAP_EVENTS, mapEventPool, pickMapEvent } from ".";
import type { MapRegionId } from "../../types";

const REGIONS: MapRegionId[] = ["foothill", "mountainside", "summit"];

describe("地图事件内容注册表", () => {
  it("当前事件都由对应分类文件盖章", () => {
    expect(Object.keys(MAP_EVENTS)).toEqual([
      "roadsideRespite",
      "fallingRocks",
      "lostPurse",
      "travelerGift",
      "fallenAdventurer",
      "weaponInStone",
      "veteranGuidance",
      "guardianInscription",
      "casinoRoulette",
    ]);
    expect(MAP_EVENTS.roadsideRespite.category).toBe("recovery");
    expect(MAP_EVENTS.fallingRocks.category).toBe("hazard");
    expect(MAP_EVENTS.lostPurse.category).toBe("reward");
    expect(MAP_EVENTS.travelerGift.category).toBe("reward");
    expect(MAP_EVENTS.fallenAdventurer.category).toBe("reward");
    expect(MAP_EVENTS.weaponInStone.category).toBe("reward");
    expect(MAP_EVENTS.veteranGuidance.category).toBe("boon");
    expect(MAP_EVENTS.guardianInscription.category).toBe("boon");
    expect(MAP_EVENTS.casinoRoulette.category).toBe("casino");
  });

  it("每个区域都有合法事件池，永久成长事件和赌场转盘权重都是旧事件的一半", () => {
    for (const region of REGIONS) {
      expect(mapEventPool(region)).toEqual([
        ["roadsideRespite", 1],
        ["fallingRocks", 1],
        ["lostPurse", 1],
        ["travelerGift", 1],
        ["fallenAdventurer", 0.5],
        ["weaponInStone", 0.25],
        ["veteranGuidance", 0.5],
        ["guardianInscription", 0.5],
        ["casinoRoulette", 0.5],
      ]);
    }
  });

  it("一次权重抽取消耗一个随机数并覆盖九个事件区间", () => {
    let calls = 0;
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.05; }))
      .toBe("roadsideRespite");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.2; }))
      .toBe("fallingRocks");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.4; }))
      .toBe("lostPurse");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.55; }))
      .toBe("travelerGift");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.68; }))
      .toBe("fallenAdventurer");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.74; }))
      .toBe("weaponInStone");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.8; }))
      .toBe("veteranGuidance");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.88; }))
      .toBe("guardianInscription");
    expect(pickMapEvent("foothill", () => { calls += 1; return 0.96; }))
      .toBe("casinoRoulette");
    expect(calls).toBe(9);
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
