import { describe, expect, it } from "vitest";
import {
  pickScrollKind,
  SCROLL_RARITY_WEIGHTS,
  SCROLLS,
  type ScrollDefinition,
} from "../content/scrolls";
import { createInitialGame, gameReducer } from "../engine";
import { findPreviousRestTile } from "../map";
import { playableScrolls } from "../selectors";
import {
  makeBattle,
  PLAYTHROUGH_CAP,
  PLAYTHROUGH_SEED,
  resolveRound,
} from "../testSupport";
import type { GameEvent, GameState } from "../types";

/** 按事件种类筛选并收窄类型，避免每个断言都写一遍类型守卫 */
function pick<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  return events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
}

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = pick(events, type);
  expect(found).toHaveLength(1);
  return found[0];
}

function step(state: GameState): GameState {
  switch (state.phase.kind) {
    case "awaitingRoll":
      return gameReducer(state, { type: "rollMovement" });
    case "turnComplete":
      return gameReducer(state, { type: "endTurn" });
    case "encounterChoice":
      return gameReducer(state, {
        type: "chooseEncounterOpponent",
        opponentId: state.phase.choice.opponentIds[0],
      });
    case "battle": {
      const battle = state.phase.battle;
      const attackerId = battle.attacker === "a" ? battle.aPlayerId : battle.bPlayerId;
      const defenderId = battle.attacker === "a" ? battle.bPlayerId : battle.aPlayerId;
      return resolveRound(state, {
        attack: attackerId
          ? state.players[attackerId].scrolls.find((item) => item.kind === "might")?.instanceId
          : undefined,
        defense: defenderId
          ? state.players[defenderId].scrolls.find((item) => item.kind === "guard")?.instanceId
          : undefined,
      });
    }
    case "pvpPenalty": {
      const loser = state.players[state.phase.penalty.loserId];
      const scroll = loser.scrolls[0];
      if (scroll) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "scroll",
          instanceId: scroll.instanceId,
        });
      }
      const equipment = loser.equipment[0];
      if (equipment) {
        return gameReducer(state, {
          type: "choosePvpPenalty",
          choice: "resource",
          resourceType: "equipment",
          instanceId: equipment.instanceId,
        });
      }
      return gameReducer(state, { type: "choosePvpPenalty", choice: "retreat" });
    }
    case "equipmentChoice":
      return gameReducer(state, { type: "chooseEquipment" });
    case "gameOver":
      return state;
  }
}

function playThrough(seed: number, maxSteps = PLAYTHROUGH_CAP) {
  let state = createInitialGame(seed);
  const events: GameEvent[] = [...state.lastEvents];
  for (let index = 0; index < maxSteps && state.phase.kind !== "gameOver"; index += 1) {
    const next = step(state);
    // 动作被拒时 gameReducer 原样返回旧 state，里面还挂着上一次的 lastEvents。
    // 不判一下就会把同一批事件收第二遍，看起来像是 id 不递增了。
    if (next !== state) events.push(...next.lastEvents);
    state = next;
  }
  return { state, events };
}

/** 一场固定的 PvP 战斗，用于观察单回合内的事件顺序 */
function stagedPvpBattle(seed: number): GameState {
  const state = createInitialGame(seed);
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("卷轴使用时机（GameRule 8.3 / 8.5 / 8.9）", () => {
  it("按 timing 而不是 kind 区分攻防两侧可用的卷轴", () => {
    const state = createInitialGame(20260805);
    const player = state.players.player1;
    player.scrolls = [
      { instanceId: "s1", kind: "might" },
      { instanceId: "s2", kind: "guard" },
      { instanceId: "s3", kind: "might" },
      { instanceId: "s4", kind: "fate" },
      { instanceId: "s5", kind: "dragonStrike" },
    ];

    expect(playableScrolls(player, "beforeAttackRoll").map((item) => item.instanceId))
      .toEqual(["s1", "s3", "s4", "s5"]);
    expect(playableScrolls(player, "beforeDefenseRoll").map((item) => item.instanceId))
      .toEqual(["s2", "s4", "s5"]);
  });

  it("每种已实现的卷轴都声明了使用时机", () => {
    for (const definition of Object.values(SCROLLS)) {
      expect(definition.timings.length).toBeGreaterThan(0);
      for (const timing of definition.timings) {
        expect(["map", "beforeAttackRoll", "beforeDefenseRoll"]).toContain(timing);
      }
    }
  });

  it("按 N/R/SR/PR 权重先抽稀有度，再从同稀有度卡池抽牌", () => {
    expect(SCROLL_RARITY_WEIGHTS).toEqual({ N: 50, R: 30, SR: 15, PR: 5 });
    expect(SCROLLS.might.rarity).toBe("N");
    expect(SCROLLS.guard.rarity).toBe("N");
    expect(SCROLLS.dragonStrike.rarity).toBe("R");
    expect(SCROLLS.fate.rarity).toBe("SR");

    // 卷轴池目前没有 PR，PR 的 5 点权重由前三档按比例分掉，总权重是 95
    const commonRolls = [0, 0];
    expect(pickScrollKind(() => commonRolls.shift() ?? 0)).toBe("might");
    const rareRolls = [0.6, 0];
    expect(pickScrollKind(() => rareRolls.shift() ?? 0)).toBe("dragonStrike");
    const superRareRolls = [0.95, 0];
    expect(pickScrollKind(() => superRareRolls.shift() ?? 0)).toBe("fate");
  });

  it("巨龙打击在掷骰前造成 7 减当前总防御的直接伤害", () => {
    let state = stagedPvpBattle(20260805);
    state.players.player1.scrolls = [{ instanceId: "dragon-attack", kind: "dragonStrike" }];
    state.players.player2.baseDefense = 2;
    state.players.player2.equipment = [
      { instanceId: "shield-1", kind: "shield" },
    ];

    state = resolveRound(state, { attack: "dragon-attack" });

    const directDamage = pick(state.lastEvents, "battleDamage")[0];
    expect(directDamage.targetSide).toBe("b");
    // 基础防御 2 + 一件木盾 1，最终受到 7 - 3 = 4 点。
    expect(directDamage.amount).toBe(4);
    expect(directDamage.hpBefore).toBe(18);
    expect(directDamage.hpAfter).toBe(14);
    expect(pick(state.lastEvents, "scrollConsumed")[0].kind).toBe("dragonStrike");
  });

  it("防守方使用巨龙打击击败攻击方后，本轮不再投骰", () => {
    let state = stagedPvpBattle(20260805);
    state.players.player1.baseDefense = 0;
    state.players.player2.scrolls = [{ instanceId: "dragon-defense", kind: "dragonStrike" }];
    if (state.phase.kind !== "battle") throw new Error("unreachable");
    state.phase.battle.hpA = 5;

    state = resolveRound(state, { defense: "dragon-defense" });

    expect(pick(state.lastEvents, "attackRolled")).toHaveLength(0);
    expect(pick(state.lastEvents, "defenseRolled")).toHaveLength(0);
    expect(only(state.lastEvents, "battleEnded").winnerSide).toBe("b");
    const directDamage = only(state.lastEvents, "battleDamage");
    expect(directDamage.targetSide).toBe("a");
    expect(directDamage.amount).toBe(7);
    expect(directDamage.hpAfter).toBe(0);
  });

  it("D20 先替换基础骰面，再叠加装备的骰面修正", () => {
    let state = createInitialGame(20260805);
    state.players.player1.scrolls = [{ instanceId: "fate-attack", kind: "fate" }];
    state.players.player2.scrolls = [{ instanceId: "fate-defense", kind: "fate" }];
    state.players.player2.equipment = [
      { instanceId: "leather-1", kind: "borderLeather" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "fate-attack", defense: "fate-defense" });

    const attack = only(state.lastEvents, "attackRolled");
    const defense = only(state.lastEvents, "defenseRolled");
    expect(attack.sides).toBe(20);
    expect(defense.sides).toBe(21);
    expect(attack.die).toBeGreaterThanOrEqual(1);
    expect(attack.die).toBeLessThanOrEqual(20);
    expect(defense.die).toBeGreaterThanOrEqual(1);
    expect(defense.die).toBeLessThanOrEqual(21);
    expect(attack.flatBonus).toBe(0);
    expect(defense.flatBonus).toBe(0);
    expect(pick(state.lastEvents, "scrollConsumed").map((event) => event.kind))
      .toEqual(["fate", "fate"]);
  });

  it("满载骰池额外投两个骰子，事件保留单骰结果并按总和结算", () => {
    let state = stagedPvpBattle(8080);
    state.players.player1.scrolls = [
      { instanceId: "loaded-1", kind: "loadedDicePool" },
    ];

    state = resolveRound(state, { attack: "loaded-1" });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(3);
    expect(attack.die).toBe(attack.dice.reduce((sum, die) => sum + die, 0));
    expect(attack.total).toBe(attack.base + attack.die + attack.flatBonus);
  });

  it("铁壁令把每个防御骰的最低结果提高到 3", () => {
    let state = stagedPvpBattle(7);
    state.players.player2.scrolls = [
      { instanceId: "wall-1", kind: "ironWallOrder" },
    ];

    state = resolveRound(state, { defense: "wall-1" });

    const defense = only(state.lastEvents, "defenseRolled");
    expect(defense.dice.every((die) => die >= 3)).toBe(true);
  });

  it("无法声明式表达的卷轴可以直接在定义里挂函数", () => {
    const might = SCROLLS.might as ScrollDefinition;
    const originalEffects = might.effects;
    might.effects = [
      {
        type: "custom",
        resolve: ({ modifiers }) => {
          modifiers.flatBonus += 5;
        },
      },
    ];

    try {
      let state = stagedPvpBattle(9191);
      state.players.player1.scrolls = [{ instanceId: "custom-1", kind: "might" }];
      state = resolveRound(state, { attack: "custom-1" });
      expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(5);
    } finally {
      might.effects = originalEffects;
    }
  });

  it("一次攻击回合每方最多消耗一张卷轴", () => {
    let state = createInitialGame(7);
    state.players.player1.scrolls = [
      { instanceId: "atk-1", kind: "might" },
      { instanceId: "atk-2", kind: "might" },
    ];
    state.players.player2.scrolls = [
      { instanceId: "def-1", kind: "guard" },
      { instanceId: "def-2", kind: "guard" },
    ];
    state.phase = {
      kind: "battle",
      battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
    };

    state = resolveRound(state, { attack: "atk-1", defense: "def-1" });

    expect(pick(state.lastEvents, "scrollConsumed")).toHaveLength(2);
    expect(state.players.player1.scrolls.map((item) => item.instanceId)).toEqual(["atk-2"]);
    expect(state.players.player2.scrolls.map((item) => item.instanceId)).toEqual(["def-2"]);
  });

  it("卷轴只影响本次攻击回合，不会延续到下一轮", () => {
    // GameRule 8.4：本次攻击结束后临时效果清除
    let state = createInitialGame(7);
    state.players.player1.scrolls = [{ instanceId: "atk-1", kind: "might" }];
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "dragon",
        hpB: 24,
      }),
    };

    state = resolveRound(state, { attack: "atk-1" });
    const boosted = only(state.lastEvents, "attackRolled");
    expect(boosted.flatBonus).toBe(3);

    // 巨龙反击后再轮到玩家，此时卷轴已消耗，加值必须归零
    while (state.phase.kind === "battle" && state.phase.battle.attacker === "b") {
      state = resolveRound(state);
    }
    if (state.phase.kind !== "battle") throw new Error("战斗提前结束，请换个种子");

    state = resolveRound(state);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(0);
  });
});

describe("事件流", () => {
  it("为每条事件分配唯一且单调递增的 id", () => {
    const { events } = playThrough(20260805);

    expect(events.length).toBeGreaterThan(50);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].id).toBeGreaterThan(events[index - 1].id);
    }
  });

  it("每次 action 只保留本次产生的事件，不累积", () => {
    let state = createInitialGame(20260805);
    const openingIds = state.lastEvents.map((event) => event.id);
    expect(openingIds.length).toBeGreaterThan(0);

    state = gameReducer(state, { type: "rollMovement" });
    const movementIds = state.lastEvents.map((event) => event.id);

    expect(movementIds.length).toBeGreaterThan(0);
    expect(movementIds.some((id) => openingIds.includes(id))).toBe(false);
  });

  it("被状态机拒绝的 action 不产生任何事件", () => {
    const state = createInitialGame(20260805);
    // 开局处于 awaitingRoll，endTurn 应当被拒绝并原样返回
    expect(gameReducer(state, { type: "endTurn" })).toBe(state);
  });

  it("开局发出 gameStarted，且先手与投骰结果一致", () => {
    const state = createInitialGame(20260805);
    const started = only(state.lastEvents, "gameStarted");

    expect(started.rolls.player1).not.toBe(started.rolls.player2);
    expect(started.starterId).toBe(
      started.rolls.player1! > started.rolls.player2! ? "player1" : "player2",
    );
    expect(state.activePlayerId).toBe(started.starterId);
  });

  it("移动发出投骰与位移事件，位移距离等于骰值", () => {
    let state = createInitialGame(20260805);
    const mover = state.activePlayerId;

    state = gameReducer(state, { type: "rollMovement" });
    const rolled = only(state.lastEvents, "movementRolled");
    const moved = only(state.lastEvents, "playerMoved");

    expect(rolled.playerId).toBe(mover);
    expect(moved.playerId).toBe(mover);
    expect(moved.from).toBe(0);
    expect(moved.to).toBe(moved.from + rolled.value);
  });

  it("战斗回合的攻防事件与伤害自洽", () => {
    let state = stagedPvpBattle(7);

    state = resolveRound(state);
    const attack = only(state.lastEvents, "attackRolled");
    const defense = only(state.lastEvents, "defenseRolled");
    const damage = only(state.lastEvents, "battleDamage");

    expect(attack.side).toBe("a");
    expect(defense.side).toBe("b");
    expect(attack.total).toBe(attack.base + attack.die + attack.flatBonus);
    expect(defense.total).toBe(defense.base + defense.die + defense.flatBonus);
    expect(damage.amount).toBe(Math.max(0, attack.total - defense.total));
    expect(damage.targetSide).toBe("b");
    expect(damage.hpAfter).toBe(Math.max(0, damage.hpBefore - damage.amount));
  });

  it("攻防事件排在伤害事件之前，保证动画可以按顺序播放", () => {
    let state = stagedPvpBattle(7);

    state = resolveRound(state);
    const order = state.lastEvents
      .filter((event) =>
        event.type === "attackRolled" ||
        event.type === "defenseRolled" ||
        event.type === "battleDamage",
      )
      .map((event) => event.type);

    expect(order).toEqual(["attackRolled", "defenseRolled", "battleDamage"]);
  });

  it("使用卷轴时发出消耗事件，并计入对应加值", () => {
    let state = stagedPvpBattle(7);
    state.players.player1.scrolls = [{ instanceId: "scroll-might", kind: "might" }];
    state.players.player2.scrolls = [{ instanceId: "scroll-guard", kind: "guard" }];

    state = resolveRound(state, { attack: "scroll-might", defense: "scroll-guard" });

    const consumed = pick(state.lastEvents, "scrollConsumed");
    expect(consumed).toHaveLength(2);
    expect(consumed.map((event) => event.instanceId).sort()).toEqual([
      "scroll-guard",
      "scroll-might",
    ]);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(3);
    expect(only(state.lastEvents, "defenseRolled").flatBonus).toBe(3);
  });

  it("未使用卷轴时不发出消耗事件", () => {
    let state = stagedPvpBattle(7);
    state.players.player1.scrolls = [{ instanceId: "scroll-might", kind: "might" }];

    state = resolveRound(state);

    expect(pick(state.lastEvents, "scrollConsumed")).toHaveLength(0);
    expect(only(state.lastEvents, "attackRolled").flatBonus).toBe(0);
  });

  it("战败发出结束、回血与后退三条事件", () => {
    let state = createInitialGame(4242);
    state.players.player1.position = 13;
    const expectedRetreat = findPreviousRestTile(state.map, 13);
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "golem",
        hpA: 1,
        hpB: 15,
        attacker: "b",
        initiativeA: 1,
        initiativeB: 6,
      }),
    };

    for (let index = 0; index < 50 && state.phase.kind === "battle"; index += 1) {
      state = resolveRound(state);
    }

    const ended = only(state.lastEvents, "battleEnded");
    expect(ended.outcome).toBe("playerLost");

    const recovery = only(state.lastEvents, "playerHpChanged");
    expect(recovery.reason).toBe("defeatRecovery");
    expect(recovery.to).toBe(Math.ceil(state.players.player1.maxHp / 2));

    const retreat = only(state.lastEvents, "playerRetreated");
    expect(retreat.from).toBe(13);
    expect(retreat.to).toBe(expectedRetreat);
    expect(state.players.player1.position).toBe(expectedRetreat);
  });

  it("战败退路在开战时锁定，不会退到本次移动途中越过的前方泉水", () => {
    let state = createInitialGame(4242);
    state.map.tiles[8].type = "spring";
    state.players.player1.position = 13;
    state.phase = {
      kind: "battle",
      battle: makeBattle({
        kind: "pve",
        aPlayerId: "player1",
        enemyId: "golem",
        retreatTo: 3,
        hpA: 1,
        hpB: 15,
        attacker: "b",
        initiativeA: 1,
        initiativeB: 6,
      }),
    };

    for (let index = 0; index < 50 && state.phase.kind === "battle"; index += 1) {
      state = resolveRound(state);
    }

    expect(state.players.player1.position).toBe(3);
    const retreat = only(state.lastEvents, "playerRetreated");
    expect(retreat.from).toBe(13);
    expect(retreat.to).toBe(3);
  });

  it("生命护符发出上限变化事件，且与实际属性一致", () => {
    // 卡池扩充会改变同一种子抽到的装备，因此寻找一局真实抽到护符的奖励，
    // 不把这条生命周期测试绑死在 EQUIPMENT 的键数量和排列上。
    let state: GameState | undefined;
    let events: GameEvent[] = [];
    for (let seed = 1; seed <= 500; seed += 1) {
      let candidate = createInitialGame(seed);
      candidate.phase = {
        kind: "battle",
        battle: makeBattle({
          kind: "pve",
          aPlayerId: "player1",
          enemyId: "golem",
          hpB: 1,
        }),
      };

      const candidateEvents: GameEvent[] = [];
      for (let index = 0; index < 50 && candidate.phase.kind === "battle"; index += 1) {
        candidate = resolveRound(candidate);
        candidateEvents.push(...candidate.lastEvents);
      }
      const granted = pick(candidateEvents, "equipmentGranted")[0];
      if (granted?.kind === "charm") {
        state = candidate;
        events = candidateEvents;
        break;
      }
    }

    if (!state) throw new Error("500 个种子内应当能抽到生命护符");

    expect(only(events, "battleEnded").outcome).toBe("playerWon");

    const granted = only(events, "equipmentGranted");
    expect(granted.kind).toBe("charm");

    const maxHpEvent = only(events, "maxHpChanged");
    expect(maxHpEvent.playerId).toBe("player1");
    expect(maxHpEvent.to).toBe(maxHpEvent.from + 4);
    expect(maxHpEvent.id).toBeGreaterThan(granted.id);
    expect(state.players.player1.maxHp).toBe(maxHpEvent.to);
  });

  it("每条 narration 都能在 history 中找到对应文字", () => {
    let state = createInitialGame(20260805);
    for (let index = 0; index < 40 && state.phase.kind !== "gameOver"; index += 1) {
      const next = step(state);
      const texts = next.history.map((entry) => entry.text);
      for (const narration of pick(next.lastEvents, "narration")) {
        expect(texts).toContain(narration.text);
      }
      state = next;
    }
  });

  it("整局事件流保持数值不变量", () => {
    const initial = createInitialGame(PLAYTHROUGH_SEED);
    const { state, events } = playThrough(PLAYTHROUGH_SEED);
    expect(state.phase.kind).toBe("gameOver");

    for (const event of pick(events, "battleDamage")) {
      expect(event.amount).toBeGreaterThanOrEqual(0);
      expect(event.hpAfter).toBeGreaterThanOrEqual(0);
      expect(event.hpAfter).toBeLessThanOrEqual(event.hpMax);
    }

    for (const event of pick(events, "playerHpChanged")) {
      // 玩家真实生命值永远不会掉到 0
      expect(event.to).toBeGreaterThanOrEqual(1);
      expect(event.to).toBeLessThanOrEqual(event.maxHp);
      expect(event.from).not.toBe(event.to);
    }

    for (const event of pick(events, "playerMoved")) {
      expect(event.to).toBeGreaterThan(event.from);
      expect(event.to).toBeLessThan(state.map.tiles.length);
    }

    for (const event of pick(events, "playerRetreated")) {
      expect(event.to).toBeLessThan(event.from);
      expect(event.to).toBeGreaterThanOrEqual(0);
    }

    expect(pick(events, "gameOver")).toHaveLength(1);

    // 事件流描述的上限变化，应当与玩家最终持有的护符数量对得上
    for (const player of Object.values(state.players)) {
      const charmCount = player.equipment.filter((item) => item.kind === "charm").length;
      expect(player.maxHp).toBe(initial.players[player.id].maxHp + charmCount * 4);
    }
  });

  it("重开一局后事件 id 接着上一局往后排", () => {
    const { state } = playThrough(20260805, 30);
    const beforeRestart = state.nextEventId;
    expect(beforeRestart).toBeGreaterThan(1);

    const restarted = gameReducer(state, { type: "restart", seed: 20260805 });

    expect(restarted.lastEvents.length).toBeGreaterThan(0);
    for (const event of restarted.lastEvents) {
      expect(event.id).toBeGreaterThanOrEqual(beforeRestart);
    }
    expect(restarted.nextEventId).toBeGreaterThan(
      restarted.lastEvents[restarted.lastEvents.length - 1].id,
    );
  });

  it("重开一局只改事件 id，玩法状态仍与同种子新开局一致", () => {
    const { state } = playThrough(20260805, 30);
    const restarted = gameReducer(state, { type: "restart", seed: 4242 });
    const fresh = createInitialGame(4242);

    expect(restarted.players).toEqual(fresh.players);
    expect(restarted.activePlayerId).toBe(fresh.activePlayerId);
    expect(restarted.rngSeed).toBe(fresh.rngSeed);
    expect(restarted.history).toEqual(fresh.history);
    expect(restarted.lastEvents.map((event) => event.type)).toEqual(
      fresh.lastEvents.map((event) => event.type),
    );
  });

  it("同种子重放产生完全一致的事件流", () => {
    const first = playThrough(20260805, 200);
    const second = playThrough(20260805, 200);

    expect(second.events).toEqual(first.events);
    expect(first.events.length).toBeGreaterThan(50);
  });

  it("不同种子产生不同的事件流", () => {
    const first = playThrough(20260805, 200);
    const second = playThrough(11111, 200);

    expect(second.events).not.toEqual(first.events);
  });
});
