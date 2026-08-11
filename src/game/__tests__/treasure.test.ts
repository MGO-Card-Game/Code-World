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

  it("重开走 basic 档，永远开不出 PR", () => {
    const seen = new Set<string>();

    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createInitialGame(seed);
      const player = state.players.player1;
      const tile = foothillTreasure(state);
      const opened = () => player.stageProgress.foothill.openedTreasureTileIds.includes(tile.id);

      // 先把「首次」用掉；踩空不算首次，所以要开到真的拿到东西为止
      for (let attempt = 0; attempt < 30 && !opened(); attempt += 1) {
        openOnce(state, player, tile);
      }
      expect(opened()).toBe(true);

      for (let round = 0; round < 25; round += 1) {
        const haul = openOnce(state, player, tile);
        for (const rarity of [...haul.scrollRarities, ...haul.equipmentRarities]) {
          seen.add(rarity);
        }
      }
    }

    // basic 是 80/15/5/0，PR 权重为 0，所以重开无论摇多少次都摸不到 PR
    expect(seen.size, "重开一次东西都没开出来，样本无效").toBeGreaterThan(0);
    expect([...seen]).not.toContain("PR");
  });

  it("首次开箱仍可能开出 basic 拿不到的 PR", () => {
    const firstHaulRarities = new Set<string>();

    for (let seed = 1; seed <= 400; seed += 1) {
      const state = createInitialGame(seed);
      const player = state.players.player1;
      const tile = foothillTreasure(state);
      const opened = () => player.stageProgress.foothill.openedTreasureTileIds.includes(tile.id);

      for (let attempt = 0; attempt < 30 && !opened(); attempt += 1) {
        const haul = openOnce(state, player, tile);
        for (const rarity of [...haul.scrollRarities, ...haul.equipmentRarities]) {
          firstHaulRarities.add(rarity);
        }
      }
    }

    // standard 有 5% 的 PR 权重；首次和重开走的确实是两张不同的权重表
    expect([...firstHaulRarities]).toContain("PR");
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
