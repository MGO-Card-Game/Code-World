import { describe, expect, it } from "vitest";
import { drawableScrollKinds, SCROLLS, type ScrollKind } from "../../content/scrolls";
import { CARD_RARITY_ORDER } from "../../content/rarity";
import { createInitialGame, gameReducer } from "../../engine";
import { rollDie } from "../../state";
import { makeBattle, resolveRound } from "../../testSupport";
import type { GameEvent, GameState } from "../../types";

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
  const state = createInitialGame(20260808);
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

describe("新增卷轴", () => {
  it("痛击只能用于攻击，并在掷骰前造成 6 减当前防御的伤害", () => {
    expect(SCROLLS.heavyStrike.rarity).toBe("R");
    expect(SCROLLS.heavyStrike.timings).toEqual(["beforeAttackRoll"]);

    let state = stagedWithHands(["heavyStrike"]);
    state.players.player2.baseDefense = 2;
    state = resolveRound(state, { attack: "attack-0" });

    const directDamage = state.lastEvents.filter(
      (event) => event.type === "battleDamage",
    )[0];
    expect(directDamage).toMatchObject({ targetSide: "b", amount: 4 });
    expect(only(state.lastEvents, "scrollConsumed").kind).toBe("heavyStrike");
  });

  it("再生秘药可在地图阶段恢复 7 点生命", () => {
    const initial = createInitialGame(7);
    initial.players[initial.activePlayerId].hp = 10;
    initial.players[initial.activePlayerId].scrolls = [{
      instanceId: "tonic-0",
      kind: "regenerativeTonic",
    }];

    const state = gameReducer(initial, { type: "useMapScroll", instanceId: "tonic-0" });

    expect(state.players[state.activePlayerId].hp).toBe(17);
    const healed = only(state.lastEvents, "playerHpChanged");
    expect(healed.to - healed.from).toBe(7);
  });

  it("精准和坚守分别把每颗攻防骰的下限提升到 4", () => {
    let state = stagedWithHands(["precision"], ["steadfast"]);
    state = resolveRound(state, { attack: "attack-0", defense: "defense-0" });

    expect(only(state.lastEvents, "attackRolled").dice.every((die) => die >= 4)).toBe(true);
    expect(only(state.lastEvents, "defenseRolled").dice.every((die) => die >= 4)).toBe(true);
  });

  it("狂暴让每颗攻击骰投两次并取较高结果", () => {
    let state = stagedWithHands(["frenzy"]);
    const probe = structuredClone(state) as GameState;
    const expected = Math.max(rollDie(probe), rollDie(probe));
    state = resolveRound(state, { attack: "attack-0" });

    expect(only(state.lastEvents, "attackRolled").dice).toEqual([expected]);
  });

  it("闪避可叠加，减少最终普通攻击伤害且最低为 0", () => {
    let state = stagedWithHands([], ["dodge", "dodge"]);
    state.players.player1.baseAttack = 5;
    state.players.player2.baseDefense = 20;
    state = resolveRound(state, { defense: ["defense-0", "defense-1"] });

    expect(only(state.lastEvents, "battleDamage").amount).toBe(0);
    expect(state.players.player2.scrolls).toHaveLength(0);
  });

  it("破阵战鼓增加一颗攻击骰，秘银骰印将骰面换为 D10", () => {
    let state = stagedWithHands(["breachDrum", "mithrilDieSeal"]);
    state = resolveRound(state, { attack: ["attack-0", "attack-1"] });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(2);
    expect(attack.sides).toBe(10);
  });

  it("天命改写增加一颗骰子，并把第一颗骰子视为最高面", () => {
    let state = stagedWithHands(["rewriteFate"]);
    state = resolveRound(state, { attack: "attack-0" });

    const attack = only(state.lastEvents, "attackRolled");
    expect(attack.dice).toHaveLength(2);
    expect(attack.dice[0]).toBe(attack.sides);
  });

  it("可抽卷轴已覆盖 N、R、SR、PR 四档", () => {
    const drawable = drawableScrollKinds();
    const rarities = new Set(drawable.map((kind) => SCROLLS[kind].rarity));

    expect([...rarities].sort()).toEqual([...CARD_RARITY_ORDER].sort());
    expect(drawable).toContain("rewriteFate");
  });
});
