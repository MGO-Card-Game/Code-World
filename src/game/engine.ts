import { ENEMIES, MAP } from "./content";
import { getAttack, getDefense } from "./selectors";
import type {
  BattleState,
  EquipmentKind,
  GameAction,
  GameState,
  MapTile,
  OwnedEquipment,
  OwnedScroll,
  Player,
  PlayerId,
  ScrollKind,
} from "./types";

const PLAYER_IDS: PlayerId[] = ["player1", "player2"];
const REST_TILES = [0, 4, 9, 14];

function otherPlayer(id: PlayerId): PlayerId {
  return id === "player1" ? "player2" : "player1";
}

function normalizedSeed(seed: number) {
  const value = seed >>> 0;
  return value === 0 ? 0x9e3779b9 : value;
}

function nextRandom(state: GameState) {
  let value = state.rngSeed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngSeed = normalizedSeed(value);
  return state.rngSeed / 0x100000000;
}

function rollDie(state: GameState, sides = 6) {
  return Math.floor(nextRandom(state) * sides) + 1;
}

function addHistory(state: GameState, text: string) {
  state.message = text;
  state.history = [text, ...state.history].slice(0, 12);
}

function newPlayer(id: PlayerId, name: string, color: string): Player {
  return {
    id,
    name,
    color,
    hp: 18,
    maxHp: 18,
    baseAttack: 4,
    baseDefense: 2,
    position: 0,
    scrolls: [],
    equipment: [],
  };
}

export function createInitialGame(seed = Date.now()): GameState {
  const state: GameState = {
    players: {
      player1: newPlayer("player1", "赤焰旅者", "#ff7a4d"),
      player2: newPlayer("player2", "苍潮旅者", "#55bde8"),
    },
    activePlayerId: "player1",
    startingPlayerId: "player1",
    turn: 1,
    phase: { kind: "awaitingRoll" },
    rngSeed: normalizedSeed(seed),
    nextInstanceId: 1,
    message: "",
    history: [],
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
  addHistory(
    state,
    `先攻投骰 ${first} : ${second}，${state.players[starter].name}先行动。`,
  );
  return state;
}

function makeInstanceId(state: GameState, prefix: string) {
  const id = `${prefix}-${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return id;
}

function grantScroll(state: GameState, player: Player, kind?: ScrollKind) {
  const selected = kind ?? (rollDie(state, 2) === 1 ? "might" : "guard");
  const scroll: OwnedScroll = {
    instanceId: makeInstanceId(state, "scroll"),
    kind: selected,
  };
  player.scrolls.push(scroll);
  return selected === "might" ? "力量卷轴" : "护盾卷轴";
}

function applyEquipmentGain(player: Player, item: OwnedEquipment) {
  player.equipment.push(item);
  if (item.kind === "charm") {
    player.maxHp += 4;
    player.hp = Math.min(player.maxHp, player.hp + 4);
  }
}

function removeEquipment(player: Player, instanceId: string) {
  const index = player.equipment.findIndex((item) => item.instanceId === instanceId);
  if (index < 0) return undefined;
  const [item] = player.equipment.splice(index, 1);
  if (item.kind === "charm") {
    player.maxHp -= 4;
    player.hp = Math.min(player.hp, player.maxHp);
  }
  return item;
}

function grantEquipment(state: GameState, player: Player) {
  const kinds: EquipmentKind[] = ["sword", "shield", "charm"];
  const available = kinds.filter(
    (kind) => player.equipment.filter((item) => item.kind === kind).length < 2,
  );
  if (available.length === 0) {
    const scrollName = grantScroll(state, player);
    return `装备已达叠加上限，改为获得${scrollName}`;
  }
  const kind = available[rollDie(state, available.length) - 1];
  applyEquipmentGain(player, {
    instanceId: makeInstanceId(state, "equipment"),
    kind,
  });
  const names: Record<EquipmentKind, string> = {
    sword: "铁剑",
    shield: "木盾",
    charm: "生命护符",
  };
  return names[kind];
}

function combatantName(state: GameState, battle: BattleState, side: "a" | "b") {
  if (side === "a") return state.players[battle.aPlayerId].name;
  if (battle.bPlayerId) return state.players[battle.bPlayerId].name;
  return ENEMIES[battle.enemyId!].name;
}

function startBattle(
  state: GameState,
  kind: BattleState["kind"],
  aPlayerId: PlayerId,
  enemyId?: string,
  bPlayerId?: PlayerId,
) {
  let initiativeA = rollDie(state);
  let initiativeB = rollDie(state);
  while (initiativeA === initiativeB) {
    initiativeA = rollDie(state);
    initiativeB = rollDie(state);
  }
  const battle: BattleState = {
    kind,
    aPlayerId,
    bPlayerId,
    enemyId,
    hpA: state.players[aPlayerId].hp,
    hpB: bPlayerId ? state.players[bPlayerId].hp : ENEMIES[enemyId!].maxHp,
    attacker: initiativeA > initiativeB ? "a" : "b",
    initiativeA,
    initiativeB,
    round: 1,
    log: [],
  };
  const firstName = combatantName(state, battle, battle.attacker);
  battle.log.unshift(`先攻 ${initiativeA} : ${initiativeB}，${firstName}先攻。`);
  state.phase = { kind: "battle", battle };
  addHistory(state, `${combatantName(state, battle, "a")}与${combatantName(state, battle, "b")}进入战斗！`);
}

function resolveTile(state: GameState, tile: MapTile, checkEncounter = true) {
  const player = state.players[state.activePlayerId];
  const opponent = state.players[otherPlayer(state.activePlayerId)];

  if (checkEncounter && !tile.safeZone && opponent.position === player.position) {
    startBattle(state, "pvp", player.id, undefined, opponent.id);
    return;
  }

  switch (tile.type) {
    case "battle":
      startBattle(state, "pve", player.id, tile.enemyId);
      return;
    case "boss":
      startBattle(state, "boss", player.id, tile.enemyId);
      return;
    case "spring": {
      const healed = Math.min(5, player.maxHp - player.hp);
      player.hp += healed;
      state.phase = { kind: "turnComplete" };
      addHistory(state, `${player.name}在泉水恢复了 ${healed} 点生命。`);
      return;
    }
    case "treasure": {
      const reward = rollDie(state, 2) === 1
        ? grantScroll(state, player)
        : grantEquipment(state, player);
      state.phase = { kind: "turnComplete" };
      addHistory(state, `${player.name}打开宝箱，获得${reward}。`);
      return;
    }
    case "event": {
      const outcome = rollDie(state, 3);
      state.phase = { kind: "turnComplete" };
      if (outcome === 1) {
        const healed = Math.min(3, player.maxHp - player.hp);
        player.hp += healed;
        addHistory(state, `奇遇带来喘息，${player.name}恢复 ${healed} 点生命。`);
      } else if (outcome === 2) {
        player.hp = Math.max(1, player.hp - 2);
        addHistory(state, `山路落石！${player.name}损失 2 点生命。`);
      } else {
        addHistory(state, `${player.name}从旅人手中获得${grantScroll(state, player)}。`);
      }
      return;
    }
    case "start":
      state.phase = { kind: "turnComplete" };
      addHistory(state, `${player.name}回到山脚营地。`);
  }
}

function consumeScroll(player: Player, instanceId: string | undefined, kind: ScrollKind) {
  if (!instanceId) return false;
  const index = player.scrolls.findIndex(
    (scroll) => scroll.instanceId === instanceId && scroll.kind === kind,
  );
  if (index < 0) return false;
  player.scrolls.splice(index, 1);
  return true;
}

function battlePlayerForSide(battle: BattleState, side: "a" | "b") {
  return side === "a" ? battle.aPlayerId : battle.bPlayerId;
}

function sideStats(state: GameState, battle: BattleState, side: "a" | "b") {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) {
    const player = state.players[playerId];
    return { attack: getAttack(player), defense: getDefense(player) };
  }
  const enemy = ENEMIES[battle.enemyId!];
  return { attack: enemy.attack, defense: enemy.defense };
}

function finishPvp(state: GameState, battle: BattleState, winnerSide: "a" | "b") {
  const winnerId = battlePlayerForSide(battle, winnerSide)!;
  const loserId = battlePlayerForSide(battle, winnerSide === "a" ? "b" : "a")!;
  const loser = state.players[loserId];
  const winner = state.players[winnerId];
  const canTransferHp = Math.min(3, winner.maxHp - winner.hp, loser.hp - 1) > 0;
  const hasResource = loser.scrolls.length + loser.equipment.length > 0;

  if (!canTransferHp && !hasResource) {
    loser.position = Math.max(0, loser.position - 3);
    state.phase = { kind: "turnComplete" };
    addHistory(state, `${loser.name}无法支付惩罚，后退 3 格。`);
    return;
  }

  state.phase = {
    kind: "pvpPenalty",
    penalty: { winnerId, loserId, tileIndex: state.players[state.activePlayerId].position },
  };
  addHistory(state, `${winner.name}赢得相遇战，${loser.name}需要选择代价。`);
}

function syncPveHp(state: GameState, battle: BattleState) {
  if (battle.kind !== "pvp") {
    state.players[battle.aPlayerId].hp = Math.max(0, battle.hpA);
  }
}

function resolveBattleRound(
  state: GameState,
  attackScrollId?: string,
  defenseScrollId?: string,
) {
  if (state.phase.kind !== "battle") return;
  const battle = state.phase.battle;
  const attackerSide = battle.attacker;
  const defenderSide = attackerSide === "a" ? "b" : "a";
  const attackerId = battlePlayerForSide(battle, attackerSide);
  const defenderId = battlePlayerForSide(battle, defenderSide);
  const attackBoost = attackerId
    ? consumeScroll(state.players[attackerId], attackScrollId, "might")
    : false;
  const defenseBoost = defenderId
    ? consumeScroll(state.players[defenderId], defenseScrollId, "guard")
    : false;
  const attackRoll = rollDie(state);
  const defenseRoll = rollDie(state);
  const attackTotal = sideStats(state, battle, attackerSide).attack + attackRoll + (attackBoost ? 3 : 0);
  const defenseTotal = sideStats(state, battle, defenderSide).defense + defenseRoll + (defenseBoost ? 3 : 0);
  const damage = Math.max(0, attackTotal - defenseTotal);

  if (defenderSide === "a") battle.hpA = Math.max(0, battle.hpA - damage);
  else battle.hpB = Math.max(0, battle.hpB - damage);

  const attackerName = combatantName(state, battle, attackerSide);
  const defenderName = combatantName(state, battle, defenderSide);
  battle.log.unshift(
    `${attackerName} 攻击 ${attackTotal} 对 防御 ${defenseTotal}，${defenderName}受到 ${damage} 点伤害。`,
  );
  battle.log = battle.log.slice(0, 8);
  syncPveHp(state, battle);

  const defenderDefeated = defenderSide === "a" ? battle.hpA <= 0 : battle.hpB <= 0;
  if (defenderDefeated) {
    if (battle.kind === "pvp") {
      finishPvp(state, battle, attackerSide);
      return;
    }
    if (defenderSide === "b") {
      const player = state.players[battle.aPlayerId];
      if (battle.kind === "boss") {
        state.phase = { kind: "gameOver", winnerId: player.id };
        addHistory(state, `${player.name}击败峰顶巨龙，夺得登峰之冠！`);
      } else {
        const enemy = ENEMIES[battle.enemyId!];
        const reward = enemy.reward === "equipment"
          ? grantEquipment(state, player)
          : grantScroll(state, player);
        state.phase = { kind: "turnComplete" };
        addHistory(state, `${player.name}击败${enemy.name}，获得${reward}。`);
      }
      return;
    }

    const player = state.players[battle.aPlayerId];
    player.hp = Math.ceil(player.maxHp / 2);
    const retreat = [...REST_TILES].reverse().find((index) => index < player.position) ?? 0;
    player.position = retreat;
    state.phase = { kind: "turnComplete" };
    addHistory(state, `${player.name}战败，恢复至半血并退回休整点。`);
    return;
  }

  battle.attacker = defenderSide;
  battle.round += 1;
  state.message = `战斗第 ${battle.round} 轮：轮到${defenderName}攻击。`;
}

function finishPenaltyAndResolveTile(state: GameState, tileIndex: number) {
  resolveTile(state, MAP[tileIndex], false);
}

function choosePvpPenalty(
  state: GameState,
  action: Extract<GameAction, { type: "choosePvpPenalty" }>,
) {
  if (state.phase.kind !== "pvpPenalty") return;
  const { winnerId, loserId, tileIndex } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];

  if (action.choice === "hp") {
    const amount = Math.min(3, winner.maxHp - winner.hp, loser.hp - 1);
    if (amount <= 0) return;
    loser.hp -= amount;
    winner.hp += amount;
    addHistory(state, `${loser.name}转移 ${amount} 点生命给${winner.name}。`);
    finishPenaltyAndResolveTile(state, tileIndex);
    return;
  }

  if (!action.instanceId || !action.resourceType) return;
  if (action.resourceType === "scroll") {
    const index = loser.scrolls.findIndex((item) => item.instanceId === action.instanceId);
    if (index < 0) return;
    const [item] = loser.scrolls.splice(index, 1);
    winner.scrolls.push(item);
  } else {
    const item = removeEquipment(loser, action.instanceId);
    if (!item) return;
    applyEquipmentGain(winner, item);
  }
  addHistory(state, `${loser.name}交出一件资源给${winner.name}。`);
  finishPenaltyAndResolveTile(state, tileIndex);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "restart") return createInitialGame(action.seed);
  const next = structuredClone(state);

  switch (action.type) {
    case "rollMovement": {
      if (next.phase.kind !== "awaitingRoll") return state;
      const player = next.players[next.activePlayerId];
      const roll = rollDie(next);
      next.lastMovementRoll = roll;
      player.position = Math.min(MAP.length - 1, player.position + roll);
      addHistory(next, `${player.name}掷出 ${roll}，抵达「${MAP[player.position].label}」。`);
      resolveTile(next, MAP[player.position]);
      return next;
    }
    case "endTurn": {
      if (next.phase.kind !== "turnComplete") return state;
      next.activePlayerId = otherPlayer(next.activePlayerId);
      next.turn += 1;
      next.lastMovementRoll = undefined;
      next.phase = { kind: "awaitingRoll" };
      addHistory(next, `轮到${next.players[next.activePlayerId].name}行动。`);
      return next;
    }
    case "resolveBattleRound":
      resolveBattleRound(next, action.attackScrollId, action.defenseScrollId);
      return next;
    case "choosePvpPenalty":
      choosePvpPenalty(next, action);
      return next;
  }
}

export function getBattleParticipants(state: GameState, battle: BattleState) {
  const a = state.players[battle.aPlayerId];
  const b = battle.bPlayerId ? state.players[battle.bPlayerId] : ENEMIES[battle.enemyId!];
  return { a, b };
}

export function getSidePlayer(state: GameState, battle: BattleState, side: "a" | "b") {
  const id = battlePlayerForSide(battle, side);
  return id ? state.players[id] : undefined;
}

export { MAP, PLAYER_IDS };
