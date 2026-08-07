import { generateMap } from "./map";
import type {
  GameEvent,
  GameEventBody,
  GameState,
  LogEntry,
  Player,
  PlayerId,
  StageProgress,
} from "./types";

/**
 * 对局状态的地基：随机数、事件流、旁白、实例 ID、建局。
 *
 * 单独成一个模块是因为所有其他部分都要用它，而它谁都不用——依赖只朝一个方向走，
 * 规则层怎么长都不会绕回来。
 */

export const PLAYER_IDS: PlayerId[] = ["player1", "player2", "player3", "player4"];
export const DEFAULT_PLAYER_IDS: PlayerId[] = PLAYER_IDS.slice(0, 2);

export function nextPlayerId(
  state: Pick<GameState, "activePlayerId" | "turnOrder"> &
    Partial<Pick<GameState, "unavailablePlayerIds">>,
) {
  const currentIndex = state.turnOrder.indexOf(state.activePlayerId);
  const unavailable = state.unavailablePlayerIds ?? [];
  for (let offset = 1; offset <= state.turnOrder.length; offset += 1) {
    const candidate = state.turnOrder[(currentIndex + offset) % state.turnOrder.length];
    if (!unavailable.includes(candidate)) return candidate;
  }
  return state.activePlayerId;
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

function newStageProgress(): StageProgress {
  return {
    laps: 0,
    defeatedEliteTileIds: [],
    openedTreasureTileIds: [],
    bossDefeated: false,
  };
}

function newPlayer(id: PlayerId, name: string, color: string, entryTileId: number): Player {
  return {
    id,
    name,
    color,
    hp: 20,
    maxHp: 20,
    baseAttack: 5,
    baseDefense: 2,
    position: entryTileId,
    checkpointTileId: entryTileId,
    stageProgress: {
      foothill: newStageProgress(),
      mountainside: newStageProgress(),
      summit: newStageProgress(),
    },
    scrolls: [],
    equipment: [],
    blessings: [],
  };
}

export function createInitialGame(
  seed = Date.now(),
  playerNames: Partial<Record<PlayerId, string>> = {},
  playerIds: readonly PlayerId[] = DEFAULT_PLAYER_IDS,
): GameState {
  if (playerIds.length < 2 || playerIds.length > PLAYER_IDS.length) {
    throw new Error("游戏人数必须为 2–4 人");
  }
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length !== playerIds.length) throw new Error("玩家席位不能重复");
  const normalized = normalizedSeed(seed);
  const defaults: Record<PlayerId, { name: string; color: string }> = {
    player1: { name: "赤焰旅者", color: "#ff7a4d" },
    player2: { name: "苍潮旅者", color: "#55bde8" },
    player3: { name: "岚风旅者", color: "#8fc58a" },
    player4: { name: "星辉旅者", color: "#c89bff" },
  };
  const map = generateMap(normalized);
  const entryTileId = map.regions[0].entryIndex;
  const players = Object.fromEntries(uniquePlayerIds.map((id) => [
    id,
    newPlayer(id, playerNames[id] ?? defaults[id].name, defaults[id].color, entryTileId),
  ])) as Record<string, Player>;
  const state: GameState = {
    players,
    turnOrder: [...uniquePlayerIds],
    unavailablePlayerIds: [],
    map,
    activePlayerId: uniquePlayerIds[0],
    startingPlayerId: uniquePlayerIds[0],
    turn: 1,
    phase: { kind: "awaitingRoll" },
    rngSeed: normalized,
    nextInstanceId: 1,
    message: { text: "" },
    history: [],
    lastEvents: [],
    nextEventId: 1,
  };

  let rolls: Partial<Record<PlayerId, number>>;
  do {
    rolls = Object.fromEntries(
      uniquePlayerIds.map((id) => [id, rollDie(state)]),
    ) as Partial<Record<PlayerId, number>>;
  } while (new Set(uniquePlayerIds.map((id) => rolls[id])).size !== uniquePlayerIds.length);

  state.turnOrder = [...uniquePlayerIds].sort((a, b) => rolls[b]! - rolls[a]!);
  const starter = state.turnOrder[0];
  state.activePlayerId = starter;
  state.startingPlayerId = starter;
  emit(state, {
    type: "gameStarted",
    starterId: starter,
    rolls,
    turnOrder: [...state.turnOrder],
  });
  addHistory(
    state,
    `先攻投骰 ${state.turnOrder.map((id) => `${state.players[id].name} ${rolls[id]}`).join("、")}；${state.players[starter].name}先行动。`,
  );
  return state;
}

export function makeInstanceId(state: GameState, prefix: string) {
  const id = `${prefix}-${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return id;
}
