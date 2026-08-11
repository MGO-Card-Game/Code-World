import { describe, expect, it } from "vitest";
import { enemyTier } from "../content/enemies";
import { createInitialGame } from "../engine";
import { resolveTile } from "../tiles";

describe("战斗格敌人刷新", () => {
  it("普通格每次进入都重新抽取漫游怪并重新判定词条", () => {
    const state = createInitialGame(20260811);
    const tile = state.map.tiles.find(
      (candidate) => candidate.region === "foothill" && candidate.type === "battle",
    )!;
    const enemies = new Set<string>();
    const affixStates = new Set<string>();

    state.players[state.activePlayerId].position = tile.id;
    for (let visit = 0; visit < 48; visit += 1) {
      resolveTile(state, tile, false);
      if (state.phase.kind !== "battle") throw new Error("应进入普通 PvE 战斗");
      const { enemyId, enemyAffix } = state.phase.battle;
      expect(enemyTier(enemyId!)).toBe("roaming");
      enemies.add(enemyId!);
      affixStates.add(enemyAffix ?? "plain");
    }

    expect(enemies.size).toBeGreaterThan(1);
    expect(affixStates.has("plain")).toBe(true);
    expect(affixStates.size).toBeGreaterThan(1);
    expect(tile.enemyId).toBeUndefined();
    expect(tile.eliteAffix).toBeUndefined();
  });

  it("精英格每次进入都重新抽取独立精英怪且不带词条", () => {
    const state = createInitialGame(20260811);
    const tile = state.map.tiles.find(
      (candidate) => candidate.region === "summit" && candidate.type === "elite",
    )!;
    const enemies = new Set<string>();

    state.players[state.activePlayerId].position = tile.id;
    for (let visit = 0; visit < 32; visit += 1) {
      resolveTile(state, tile, false);
      if (state.phase.kind !== "battle") throw new Error("应进入精英 PvE 战斗");
      const { enemyId, enemyAffix } = state.phase.battle;
      expect(enemyTier(enemyId!)).toBe("elite");
      expect(enemyAffix).toBeUndefined();
      enemies.add(enemyId!);
    }

    expect(enemies.size).toBeGreaterThan(1);
    expect(tile.enemyId).toBeUndefined();
    expect(tile.eliteAffix).toBeUndefined();
  });

  it("相同种子和相同进入顺序仍得到完全相同的遭遇序列", () => {
    const sequence = () => {
      const state = createInitialGame(4242);
      const tile = state.map.tiles.find((candidate) => candidate.type === "battle")!;
      state.players[state.activePlayerId].position = tile.id;
      return Array.from({ length: 16 }, () => {
        resolveTile(state, tile, false);
        if (state.phase.kind !== "battle") throw new Error("应进入普通 PvE 战斗");
        return [state.phase.battle.enemyId, state.phase.battle.enemyAffix];
      });
    };

    expect(sequence()).toEqual(sequence());
  });
});
