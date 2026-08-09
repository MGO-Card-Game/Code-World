import { describe, expect, it } from "vitest";
import { MAP_EVENTS, mapEventPool, pickMapEvent } from ".";
import type { MapRegionId } from "../../types";

const REGIONS: MapRegionId[] = ["foothill", "mountainside", "summit"];

describe("地图事件内容注册表", () => {
  it("当前事件都由对应分类文件盖章", () => {
    expect(Object.keys(MAP_EVENTS)).toEqual([
      "roadsideRespite",
      "hotSpring",
      "fallingRocks",
      "mire",
      "impulseBuy",
      "lostPurse",
      "travelerGift",
      "fallenAdventurer",
      "weaponInStone",
      "coinRain",
      "campfire",
      "requisition",
      "veteranGuidance",
      "guardianInscription",
      "casinoRoulette",
    ]);
    expect(MAP_EVENTS.roadsideRespite.category).toBe("recovery");
    expect(MAP_EVENTS.hotSpring.category).toBe("recovery");
    expect(MAP_EVENTS.fallingRocks.category).toBe("hazard");
    expect(MAP_EVENTS.mire.category).toBe("hazard");
    expect(MAP_EVENTS.impulseBuy.category).toBe("hazard");
    expect(MAP_EVENTS.lostPurse.category).toBe("reward");
    expect(MAP_EVENTS.travelerGift.category).toBe("reward");
    expect(MAP_EVENTS.fallenAdventurer.category).toBe("reward");
    expect(MAP_EVENTS.weaponInStone.category).toBe("reward");
    expect(MAP_EVENTS.coinRain.category).toBe("reward");
    expect(MAP_EVENTS.campfire.category).toBe("reward");
    expect(MAP_EVENTS.requisition.category).toBe("reward");
    expect(MAP_EVENTS.veteranGuidance.category).toBe("boon");
    expect(MAP_EVENTS.guardianInscription.category).toBe("boon");
    expect(MAP_EVENTS.casinoRoulette.category).toBe("casino");
  });


  it("每个区域都有合法事件池，强于基础档的事件权重都是旧事件的一半", () => {
    for (const region of REGIONS) {
      expect(mapEventPool(region)).toEqual([
        ["roadsideRespite", 1],
        ["hotSpring", 0.5],
        ["fallingRocks", 1],
        ["mire", 0.5],
        ["impulseBuy", 1],
        ["lostPurse", 1],
        ["travelerGift", 1],
        ["fallenAdventurer", 0.5],
        ["weaponInStone", 0.25],
        ["coinRain", 0.5],
        ["campfire", 0.5],
        ["requisition", 0.25],
        ["veteranGuidance", 0.5],
        ["guardianInscription", 0.5],
        ["casinoRoulette", 0.5],
      ]);
    }
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

  it("一次权重抽取消耗一个随机数并覆盖十五个事件区间", () => {
    // 取值都落在各自区间的中段：权重总和是 9.5，边界值容易随权重微调而漂移。
    const cases = [
      [0.05, "roadsideRespite"],
      [0.13, "hotSpring"],
      [0.21, "fallingRocks"],
      [0.29, "mire"],
      [0.37, "impulseBuy"],
      [0.47, "lostPurse"],
      [0.58, "travelerGift"],
      [0.66, "fallenAdventurer"],
      [0.7, "weaponInStone"],
      [0.74, "coinRain"],
      [0.79, "campfire"],
      [0.83, "requisition"],
      [0.87, "veteranGuidance"],
      [0.92, "guardianInscription"],
      [0.97, "casinoRoulette"],
    ] as const;

    let calls = 0;
    for (const [ticket, expected] of cases) {
      expect(pickMapEvent("foothill", () => { calls += 1; return ticket; })).toBe(expected);
    }
    // 每次抽取只消耗一个随机数
    expect(calls).toBe(cases.length);
    expect(cases).toHaveLength(Object.keys(MAP_EVENTS).length);
  });
});
