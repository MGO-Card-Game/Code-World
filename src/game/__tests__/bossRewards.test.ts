import { describe, expect, it } from "vitest";
import { finishBattle } from "../battle";
import { ECONOMY } from "../economy";
import { createInitialGame, gameReducer } from "../engine";
import { STAT_GROWTH } from "../growth";
import { canAct } from "../multiplayer";
import { getAttack, getDefense } from "../selectors";
import { makeBattle } from "../testSupport";
import type { GameState, MapRegion } from "../types";

/** 打赢山脚首领，停在奖励弹层上。 */
function afterStageBossVictory(seed = 20260810): { state: GameState; region: MapRegion } {
  const state = createInitialGame(seed);
  const region = state.map.regions[0];
  finishBattle(
    state,
    makeBattle({
      kind: "boss",
      aPlayerId: "player1",
      enemyId: region.bossEnemyId,
      stageId: region.id,
      tileIndex: region.gateIndex,
    }),
    "a",
  );
  return { state, region };
}

describe("阶段首领奖励", () => {
  it("发金币、卷轴和装备各一份，全部记在首领这一档上", () => {
    const { state } = afterStageBossVictory();
    const player = state.players.player1;

    expect(player.gold).toBe(ECONOMY.bossGold);
    expect(player.scrolls).toHaveLength(1);
    expect(player.equipment).toHaveLength(1);

    if (state.phase.kind !== "pveReward") throw new Error("应停在奖励弹层");
    expect(state.phase.notice.rewards.map((item) => item.resourceType))
      .toEqual(["gold", "scroll", "equipment"]);
    expect(state.phase.notice.rewards.every((item) => item.source === "boss")).toBe(true);
  });

  it("奖励弹层里的卷轴对旁观者只是「一张卷轴」", () => {
    const { state } = afterStageBossVictory();

    if (state.phase.kind !== "pveReward") throw new Error("应停在奖励弹层");
    const scroll = state.phase.notice.rewards.find((item) => item.resourceType === "scroll")!;
    expect(scroll.publicName).toBe("一张卷轴");
    expect(scroll.name).not.toBe(scroll.publicName);
  });

  it("确认奖励后进入加点，加点只能由本人做", () => {
    const { state, region } = afterStageBossVictory();

    const acknowledged = gameReducer(state, { type: "acknowledgePveReward" });

    expect(acknowledged.phase.kind).toBe("statGrowthChoice");
    if (acknowledged.phase.kind !== "statGrowthChoice") throw new Error("应进入加点");
    expect(acknowledged.phase.choice.playerId).toBe("player1");
    // 玩家已经被送进下一阶段，加点归属的也该是新阶段
    expect(acknowledged.phase.choice.stageId).not.toBe(region.id);
    expect(canAct(acknowledged, { type: "chooseStatGrowth", option: "attack" }, "player1"))
      .toBe(true);
    expect(canAct(acknowledged, { type: "chooseStatGrowth", option: "attack" }, "player2"))
      .toBe(false);
  });

  it("装备槽全满时先选替换，再看奖励，最后才加点", () => {
    const state = createInitialGame(20260812);
    // 四个分类全部占满，首领奖励的那件装备必定要经过替换/放弃
    state.players.player1.equipment = [
      { instanceId: "weapon-full", kind: "sword" },
      { instanceId: "armor-full", kind: "shield" },
      { instanceId: "shoes-full", kind: "travelerBoots" },
      { instanceId: "accessory-full-1", kind: "charm" },
      { instanceId: "accessory-full-2", kind: "huntersPointer" },
    ];
    const region = state.map.regions[0];
    finishBattle(
      state,
      makeBattle({
        kind: "boss",
        aPlayerId: "player1",
        enemyId: region.bossEnemyId,
        stageId: region.id,
        tileIndex: region.gateIndex,
      }),
      "a",
    );

    expect(state.phase.kind).toBe("equipmentChoice");
    if (state.phase.kind !== "equipmentChoice") throw new Error("应先要求处理装备");
    expect(state.phase.choice.resume.kind).toBe("showPveReward");

    // 放弃新装备，链路要接回奖励弹层而不是直接结束回合
    const discarded = gameReducer(state, { type: "chooseEquipment" });
    expect(discarded.phase.kind).toBe("pveReward");

    const acknowledged = gameReducer(discarded, { type: "acknowledgePveReward" });
    expect(acknowledged.phase.kind).toBe("statGrowthChoice");
  });

  it("普通战斗的奖励不会跟出加点", () => {
    const state = createInitialGame(20260811);
    const tile = state.map.tiles.find(
      (candidate) => candidate.region === "foothill" && candidate.type === "battle",
    )!;
    finishBattle(
      state,
      makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: tile.enemyId,
        stageId: tile.region,
        tileIndex: tile.id,
      }),
      "a",
    );

    if (state.phase.kind !== "pveReward") throw new Error("应停在奖励弹层");
    expect(state.phase.notice.statGrowth).toBeUndefined();
    expect(gameReducer(state, { type: "acknowledgePveReward" }).phase.kind)
      .toBe("turnComplete");
  });
});

describe("自主加点", () => {
  function atGrowthChoice() {
    const { state } = afterStageBossVictory();
    return gameReducer(state, { type: "acknowledgePveReward" });
  }

  it("攻击和防御各加 1，只动底子不动装备加成", () => {
    const base = atGrowthChoice();
    const attackBefore = getAttack(base.players.player1);
    const defenseBefore = getDefense(base.players.player1);

    const attack = gameReducer(base, { type: "chooseStatGrowth", option: "attack" });
    expect(attack.players.player1.baseAttack).toBe(base.players.player1.baseAttack + 1);
    expect(getAttack(attack.players.player1)).toBe(attackBefore + 1);
    expect(attack.phase.kind).toBe("turnComplete");

    const defense = gameReducer(base, { type: "chooseStatGrowth", option: "defense" });
    expect(defense.players.player1.baseDefense).toBe(base.players.player1.baseDefense + 1);
    expect(getDefense(defense.players.player1)).toBe(defenseBefore + 1);
  });

  it("生命上限加 3，并把这 3 点当场补上", () => {
    const base = atGrowthChoice();
    base.players.player1.hp = 6;
    const maxHpBefore = base.players.player1.maxHp;

    const grown = gameReducer(base, { type: "chooseStatGrowth", option: "maxHp" });
    const player = grown.players.player1;

    expect(player.maxHp).toBe(maxHpBefore + STAT_GROWTH.maxHp.value);
    expect(player.hp).toBe(6 + STAT_GROWTH.maxHp.value);
    expect(grown.lastEvents).toContainEqual(expect.objectContaining({
      type: "playerHpChanged",
      playerId: "player1",
      from: 6,
      to: 9,
      reason: "growth",
    }));
  });

  it("满血时选生命上限不会溢出到上限之外", () => {
    const base = atGrowthChoice();
    base.players.player1.hp = base.players.player1.maxHp;

    const player = gameReducer(base, { type: "chooseStatGrowth", option: "maxHp" })
      .players.player1;

    expect(player.hp).toBe(player.maxHp);
  });

  it("加点做完就不能再点第二次", () => {
    const base = atGrowthChoice();

    const once = gameReducer(base, { type: "chooseStatGrowth", option: "attack" });
    const twice = gameReducer(once, { type: "chooseStatGrowth", option: "attack" });

    expect(twice).toBe(once);
    expect(twice.players.player1.baseAttack).toBe(base.players.player1.baseAttack + 1);
  });
});
