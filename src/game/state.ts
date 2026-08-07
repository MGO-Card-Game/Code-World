import { generateMap } from "./map";
import type {
  GameEvent,
  GameEventBody,
  GameState,
  LogEntry,
  Player,
  PlayerId,
} from "./types";

/**
 * 对局状态的地基：随机数、事件流、旁白、实例 ID、建局。
 *
 * 单独成一个模块是因为所有其他部分都要用它，而它谁都不用——依赖只朝一个方向走，
 * 规则层怎么长都不会绕回来。
 */

export const PLAYER_IDS: PlayerId[] = ["player1", "player2"];

export function otherPlayer(id: PlayerId): PlayerId {
  return id === "player1" ? "player2" : "player1";
}

function normalizedSeed(seed: number) {
  const value = seed >>> 0;
  return value === 0 ? 0x9e3779b9 : value;
}

export function nextRandom(state: GameState) {
  let value = state.rngSeed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngSeed = normalizedSeed(value);
  return state.rngSeed / 0x100000000;
}

export function rollDie(state: GameState, sides = 6) {
  return Math.floor(nextRandom(state) * sides) + 1;
}

/**
 * 追加一条结构化事件。不消耗随机数，因此可以在结算流程的任意位置插入，
 * 不会影响同种子重放的结果。
 *
 * 约定：先发机制事件，再发 narration——旁白是对刚发生的事情的总结。
 */
export function emit(state: GameState, body: GameEventBody) {
  const event = { ...body, id: state.nextEventId } as GameEvent;
  state.nextEventId += 1;
  state.lastEvents.push(event);
}

/**
 * 记录一条旁白。
 *
 * secret 用于暗牌：只有 owner 看得到 text，其他人由 viewFor 换成 publicText。
 * 抽卡类文案必须带上它，否则「获得力量卷轴」这一句会让裁剪手牌数组白做。
 */
export function addHistory(
  state: GameState,
  text: string,
  secret?: { owner: PlayerId; publicText: string },
) {
  const entry: LogEntry = secret ? { text, secret } : { text };
  state.message = entry;
  state.history = [entry, ...state.history].slice(0, 12);
  emit(state, secret ? { type: "narration", text, secret } : { type: "narration", text });
}

function newPlayer(id: PlayerId, name: string, color: string): Player {
  return {
    id,
    name,
    color,
    hp: 20,
    maxHp: 20,
    baseAttack: 5,
    baseDefense: 2,
    position: 0,
    scrolls: [],
    equipment: [],
  };
}

export function createInitialGame(
  seed = Date.now(),
  playerNames: Partial<Record<PlayerId, string>> = {},
): GameState {
  const normalized = normalizedSeed(seed);
  const state: GameState = {
    players: {
      player1: newPlayer("player1", playerNames.player1 ?? "赤焰旅者", "#ff7a4d"),
      player2: newPlayer("player2", playerNames.player2 ?? "苍潮旅者", "#55bde8"),
    },
    map: generateMap(normalized),
    activePlayerId: "player1",
    startingPlayerId: "player1",
    turn: 1,
    phase: { kind: "awaitingRoll" },
    rngSeed: normalized,
    nextInstanceId: 1,
    message: { text: "" },
    history: [],
    lastEvents: [],
    nextEventId: 1,
  };

  let first = rollDie(state);
  let second = rollDie(state);
  while (first === second) {
    first = rollDie(state);
    second = rollDie(state);
  }
  const starter: PlayerId = first > second ? "player1" : "player2";
  state.activePlayerId = starter;
  state.startingPlayerId = starter;
  emit(state, {
    type: "gameStarted",
    starterId: starter,
    rollP1: first,
    rollP2: second,
  });
  addHistory(
    state,
    `先攻投骰 ${first} : ${second}，${state.players[starter].name}先行动。`,
  );
  return state;
}

export function makeInstanceId(state: GameState, prefix: string) {
  const id = `${prefix}-${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return id;
}
