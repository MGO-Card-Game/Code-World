import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "../content/equipment";
import { SCROLLS } from "../content/scrolls";
import { ECONOMY } from "../economy";
import { createInitialGame } from "../engine";
import { openTreasure, TREASURE_OUTCOME_WEIGHTS } from "../treasure";
import type { GameState, MapTile, Player } from "../types";

function foothillTreasure(state: GameState): MapTile {
  return state.map.tiles.find(
    (tile) => tile.type === "treasure" && tile.region === "foothill",
  )!;
}

/** 开一次箱，返回这一次实际到手的东西。 */
function openOnce(state: GameState, player: Player, tile: MapTile) {
  const goldBefore = player.gold;
  player.scrolls = [];
  player.equipment = [];
  openTreasure(state, player, tile);
  return {
    gold: player.gold - goldBefore,
    scrollRarities: player.scrolls.map((scroll) => SCROLLS[scroll.kind].rarity),
    equipmentRarities: player.equipment.map((item) => EQUIPMENT[item.kind].rarity),
  };
}

describe("宝箱", () => {
  it("结果权重合计 100，空箱是其中一档而不是单独一条判定", () => {
    const total = TREASURE_OUTCOME_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
    expect(total).toBe(100);
    expect(TREASURE_OUTCOME_WEIGHTS.map(([outcome]) => outcome)).toContain("empty");
  });

  it("同一个宝箱可以反复开，不会开过一次就永久搜空", () => {
    const state = createInitialGame(20260811);
    const player = state.players.player1;
    const tile = foothillTreasure(state);

    let hauls = 0;
    for (let round = 0; round < 40; round += 1) {
      const haul = openOnce(state, player, tile);
      const gotSomething = haul.gold > 0
        || haul.scrollRarities.length > 0
        || haul.equipmentRarities.length > 0;
      if (gotSomething) hauls += 1;
    }

    // 旧实现里第 2 次起必定空手；能反复开出东西才说明一次性锁死已经去掉
    expect(hauls).toBeGreaterThan(1);
  });

  it("空箱什么都不给，也不占用「首次」那一发", () => {
    const state = createInitialGame(20260811);
    const player = state.players.player1;
    const tile = foothillTreasure(state);

    let sawEmpty = false;
    for (let round = 0; round < 40 && !sawEmpty; round += 1) {
      const goldBefore = player.gold;
      const opened = [...player.stageProgress.foothill.openedTreasureTileIds];
      const haul = openOnce(state, player, tile);
      const empty = haul.gold === 0
        && haul.scrollRarities.length === 0
        && haul.equipmentRarities.length === 0;
      if (!empty) continue;

      sawEmpty = true;
      expect(player.gold).toBe(goldBefore);
      // 空箱不写进已开列表：第一次踩空不该把 standard 那一档手感烧掉
      expect(player.stageProgress.foothill.openedTreasureTileIds).toEqual(opened);
      expect(state.phase.kind).toBe("turnComplete");
    }

    expect(sawEmpty, "40 次里一次空箱都没有，空箱档可能没生效").toBe(true);
  });

  it("首次走 standard、重开走 meager，两张权重表拉得开", () => {
    const firstHaul: string[] = [];
    const reopen: string[] = [];

    for (let seed = 1; seed <= 300; seed += 1) {
      const state = createInitialGame(seed);
      const player = state.players.player1;
      const tile = foothillTreasure(state);
      const opened = () => player.stageProgress.foothill.openedTreasureTileIds.includes(tile.id);

      // 首次那一发：踩空不算首次，所以要开到真的拿到东西为止。
      // 抽中纯金币档同样算「拿到东西」，那一次不产出稀有度样本。
      for (let attempt = 0; attempt < 30 && !opened(); attempt += 1) {
        const haul = openOnce(state, player, tile);
        firstHaul.push(...haul.scrollRarities, ...haul.equipmentRarities);
      }
      expect(opened()).toBe(true);

      for (let round = 0; round < 15; round += 1) {
        const haul = openOnce(state, player, tile);
        reopen.push(...haul.scrollRarities, ...haul.equipmentRarities);
      }
    }

    const shareOf = (rarity: string, samples: string[]) =>
      samples.filter((observed) => observed === rarity).length / samples.length;

    expect(firstHaul.length, "首次样本太少，统计断言无意义").toBeGreaterThan(100);
    expect(reopen.length, "重开样本太少，统计断言无意义").toBeGreaterThan(1000);

    // standard 的 N 是 50%、meager 是 85%——差距只有在两张表真的分开时才拉得出来
    expect(shareOf("N", reopen)).toBeGreaterThan(0.75);
    expect(shareOf("N", firstHaul)).toBeLessThan(0.68);

    // meager 的 PR 权重是 0：反复刷同一个箱子够不着 PR，而首次够得着
    expect(reopen).not.toContain("PR");
    expect(firstHaul).toContain("PR");
  });

  it("开出金币时给的是 treasureGold 那一档", () => {
    const state = createInitialGame(20260811);
    const player = state.players.player1;
    const tile = foothillTreasure(state);

    for (let round = 0; round < 40; round += 1) {
      const haul = openOnce(state, player, tile);
      if (haul.gold > 0) expect(haul.gold).toBe(ECONOMY.treasureGold);
    }
  });
});
