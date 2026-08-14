import { describe, expect, it } from "vitest";
import { drawableScrollKinds, SCROLLS, type ScrollKind } from "../content/scrolls";
import { createInitialGame, gameReducer } from "../engine";
import { rollDie } from "../state";
import { makeBattle, resolveRound } from "../testSupport";
import type { BattleState, GameEvent, GameState } from "../types";

function only<T extends GameEvent["type"]>(events: GameEvent[], type: T) {
  const found = events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

function stagedWithHands(
  attackerKinds: readonly ScrollKind[] = [],
  defenderKinds: readonly ScrollKind[] = [],
) {
  const state = createInitialGame(20260814);
  state.players.player1.scrolls = attackerKinds.map((kind, index) => ({
    instanceId: `attack-${index}`,
    kind,
  }));
  state.players.player2.scrolls = defenderKinds.map((kind, index) => ({
    instanceId: `defense-${index}`,
    kind,
  }));
  state.phase = {
    kind: "battle",
    battle: makeBattle({ kind: "pvp", aPlayerId: "player1", bPlayerId: "player2" }),
  };
  return state;
}

describe("第一批新增卷轴", () => {
  it("首批九张牌全部进入随机卡池", () => {
    const added = [
      "defenseDrum",
      "composure",
      "octahedralDieSeal",
      "lightStrike",
      "thickArmor",
      "headhuntOrder",
      "leapForward",
      "reverseScale",
      "duelContract",
    ] as const;
    const drawable = drawableScrollKinds();

    for (const kind of added) expect(drawable).toContain(kind);
    expect(SCROLLS.duelContract.name).toBe("决斗契约");
  });

  it("守阵战鼓让防守方额外投一颗骰子", () => {
    let state = stagedWithHands([], ["defenseDrum"]);
    state = resolveRound(state, { defense: "defense-0" });

    expect(only(state.lastEvents, "defenseRolled").dice).toHaveLength(2);
  });

  it("沉稳让每颗防御骰投两次并取较高结果", () => {
    let state = stagedWithHands([], ["composure"]);
    const probe = structuredClone(state) as GameState;
    rollDie(probe); // 攻击方先投一颗骰子
    const expected = Math.max(rollDie(probe), rollDie(probe));

    state = resolveRound(state, { defense: "defense-0" });

    expect(only(state.lastEvents, "defenseRolled").dice).toEqual([expected]);
  });

  it("八面骰印把本次骰面改为 D8", () => {
    let state = stagedWithHands(["octahedralDieSeal"]);
    state = resolveRound(state, { attack: "attack-0" });

    expect(only(state.lastEvents, "attackRolled").sides).toBe(8);
  });

  it("轻击在掷骰前造成 4 点减当前防御的伤害", () => {
    let state = stagedWithHands(["lightStrike"]);
    state.players.player2.baseDefense = 1;
    state = resolveRound(state, { attack: "attack-0" });

    expect(state.lastEvents.filter((event) => event.type === "battleDamage")[0])
      .toMatchObject({ targetSide: "b", amount: 3 });
  });

  it("厚甲让本次最终伤害减少 5", () => {
    let state = stagedWithHands([], ["thickArmor"]);
    state.players.player1.baseAttack = 20;
    state.players.player2.baseDefense = 0;
    state = resolveRound(state, { defense: "defense-0" });

    const attack = only(state.lastEvents, "attackRolled");
    const defense = only(state.lastEvents, "defenseRolled");
    expect(only(state.lastEvents, "battleDamage").amount).toBe(
      Math.max(0, attack.total - defense.total - 5),
    );
  });

  describe("猎头令", () => {
    function stagedAgainst(enemy: Partial<BattleState>) {
      const state = createInitialGame(20260814);
      state.players.player1.scrolls = [{ instanceId: "order-1", kind: "headhuntOrder" }];
      state.phase = {
        kind: "battle",
        battle: makeBattle({ kind: "pve", aPlayerId: "player1", ...enemy }),
      };
      return state;
    }

    it("对精英和首领额外造成 5 点伤害", () => {
      for (const enemy of [
        { kind: "boss", enemyId: "dragon" },
        { enemyId: "razorbackAlpha" },
        { enemyId: "slime", enemyAffix: "frenzied" },
      ] satisfies Partial<BattleState>[]) {
        let state = stagedAgainst(enemy);
        state = resolveRound(state, { attack: "order-1" });

        const attack = only(state.lastEvents, "attackRolled");
        const defense = only(state.lastEvents, "defenseRolled");
        expect(only(state.lastEvents, "battleDamage").amount).toBe(
          Math.max(0, attack.total - defense.total) + 5,
        );
      }
    });

    it("对普通怪和玩家不能使用", () => {
      for (const target of [
        { enemyId: "slime" },
        { kind: "pvp", bPlayerId: "player2" },
      ] satisfies Partial<BattleState>[]) {
        const state = stagedAgainst(target);
        expect(gameReducer(state, {
          type: "submitScrollChoice",
          side: "a",
          instanceIds: ["order-1"],
        })).toBe(state);
      }
    });
  });

  it("跃进不掷骰并逐格前进 4 格", () => {
    const initial = createInitialGame(20260814);
    const player = initial.players[initial.activePlayerId];
    player.position = 5;
    player.scrolls = [{ instanceId: "leap-1", kind: "leapForward" }];
    initial.map.tiles[9].type = "start";
    initial.phase = { kind: "awaitingRoll" };

    const state = gameReducer(initial, { type: "useMapScroll", instanceId: "leap-1" });

    expect(state.players[state.activePlayerId].position).toBe(9);
    expect(state.lastEvents.some((event) => event.type === "movementRolled")).toBe(false);
    expect(only(state.lastEvents, "playerMoved")).toMatchObject({ from: 5, to: 9 });
  });

  it("逆鳞对玩家也能使用：额外投两颗骰子且第一颗取最高面", () => {
    let state = stagedWithHands(["reverseScale"]);
    state = resolveRound(state, { attack: "attack-0" });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(3);
    expect(attack.dice[0]).toBe(attack.sides);
  });
});
