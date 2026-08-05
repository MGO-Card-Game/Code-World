import { ENEMIES, MAP } from "./content";
import { getAttack, getDefense } from "./selectors";
import type {
  BattleState,
  CombatSide,
  EquipmentKind,
  GameAction,
  GameEvent,
  GameEventBody,
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

/**
 * 追加一条结构化事件。不消耗随机数，因此可以在结算流程的任意位置插入，
 * 不会影响同种子重放的结果。
 *
 * 约定：先发机制事件，再发 narration——旁白是对刚发生的事情的总结。
 */
function emit(state: GameState, body: GameEventBody) {
  const event = { ...body, id: state.nextEventId } as GameEvent;
  state.nextEventId += 1;
  state.lastEvents.push(event);
}

function addHistory(state: GameState, text: string) {
  state.message = text;
  state.history = [text, ...state.history].slice(0, 12);
  emit(state, { type: "narration", text });
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
  emit(state, {
    type: "scrollGranted",
    playerId: player.id,
    instanceId: scroll.instanceId,
    kind: selected,
  });
  return selected === "might" ? "力量卷轴" : "护盾卷轴";
}

/**
 * 只负责装备入包和属性联动，不发获得/转移事件——
 * 调用方决定这是“新获得”还是“相遇战转移”。
 */
function applyEquipmentStats(
  state: GameState,
  player: Player,
  item: OwnedEquipment,
) {
  player.equipment.push(item);
  if (item.kind !== "charm") return;
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp += 4;
  player.hp = Math.min(player.maxHp, player.hp + 4);
  emit(state, {
    type: "maxHpChanged",
    playerId: player.id,
    from: maxHpBefore,
    to: player.maxHp,
  });
  emit(state, {
    type: "playerHpChanged",
    playerId: player.id,
    from: hpBefore,
    to: player.hp,
    maxHp: player.maxHp,
    reason: "charm",
  });
}

function removeEquipmentStats(
  state: GameState,
  player: Player,
  instanceId: string,
) {
  const index = player.equipment.findIndex((item) => item.instanceId === instanceId);
  if (index < 0) return undefined;
  const [item] = player.equipment.splice(index, 1);
  if (item.kind === "charm") {
    const maxHpBefore = player.maxHp;
    const hpBefore = player.hp;
    player.maxHp -= 4;
    player.hp = Math.min(player.hp, player.maxHp);
    emit(state, {
      type: "maxHpChanged",
      playerId: player.id,
      from: maxHpBefore,
      to: player.maxHp,
    });
    if (player.hp !== hpBefore) {
      emit(state, {
        type: "playerHpChanged",
        playerId: player.id,
        from: hpBefore,
        to: player.hp,
        maxHp: player.maxHp,
        reason: "charm",
      });
    }
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
  const item: OwnedEquipment = {
    instanceId: makeInstanceId(state, "equipment"),
    kind,
  };
  emit(state, {
    type: "equipmentGranted",
    playerId: player.id,
    instanceId: item.instanceId,
    kind,
  });
  applyEquipmentStats(state, player, item);
  const names: Record<EquipmentKind, string> = {
    sword: "铁剑",
    shield: "木盾",
    charm: "生命护符",
  };
  return names[kind];
}

function combatantName(state: GameState, battle: BattleState, side: CombatSide) {
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
  emit(state, {
    type: "battleStarted",
    battleKind: kind,
    aPlayerId,
    bPlayerId,
    enemyId,
  });
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
  emit(state, {
    type: "initiativeRolled",
    rollA: initiativeA,
    rollB: initiativeB,
    firstAttacker: battle.attacker,
  });
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
      const hpBefore = player.hp;
      const healed = Math.min(5, player.maxHp - player.hp);
      player.hp += healed;
      state.phase = { kind: "turnComplete" };
      if (healed > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "spring",
        });
      }
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
        const hpBefore = player.hp;
        const healed = Math.min(3, player.maxHp - player.hp);
        player.hp += healed;
        if (healed > 0) {
          emit(state, {
            type: "playerHpChanged",
            playerId: player.id,
            from: hpBefore,
            to: player.hp,
            maxHp: player.maxHp,
            reason: "event",
          });
        }
        addHistory(state, `奇遇带来喘息，${player.name}恢复 ${healed} 点生命。`);
      } else if (outcome === 2) {
        const hpBefore = player.hp;
        player.hp = Math.max(1, player.hp - 2);
        if (player.hp !== hpBefore) {
          emit(state, {
            type: "playerHpChanged",
            playerId: player.id,
            from: hpBefore,
            to: player.hp,
            maxHp: player.maxHp,
            reason: "event",
          });
        }
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

function consumeScroll(
  state: GameState,
  player: Player,
  instanceId: string | undefined,
  kind: ScrollKind,
) {
  if (!instanceId) return false;
  const index = player.scrolls.findIndex(
    (scroll) => scroll.instanceId === instanceId && scroll.kind === kind,
  );
  if (index < 0) return false;
  player.scrolls.splice(index, 1);
  emit(state, {
    type: "scrollConsumed",
    playerId: player.id,
    instanceId,
    kind,
  });
  return true;
}

function battlePlayerForSide(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.aPlayerId : battle.bPlayerId;
}

function sideStats(state: GameState, battle: BattleState, side: CombatSide) {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) {
    const player = state.players[playerId];
    return { attack: getAttack(player), defense: getDefense(player) };
  }
  const enemy = ENEMIES[battle.enemyId!];
  return { attack: enemy.attack, defense: enemy.defense };
}

function sideMaxHp(state: GameState, battle: BattleState, side: CombatSide) {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) return state.players[playerId].maxHp;
  return ENEMIES[battle.enemyId!].maxHp;
}

function finishPvp(state: GameState, battle: BattleState, winnerSide: CombatSide) {
  const winnerId = battlePlayerForSide(battle, winnerSide)!;
  const loserId = battlePlayerForSide(battle, winnerSide === "a" ? "b" : "a")!;
  const loser = state.players[loserId];
  const winner = state.players[winnerId];
  const canTransferHp = Math.min(3, winner.maxHp - winner.hp, loser.hp - 1) > 0;
  const hasResource = loser.scrolls.length + loser.equipment.length > 0;

  if (!canTransferHp && !hasResource) {
    const positionBefore = loser.position;
    loser.position = Math.max(0, loser.position - 3);
    state.phase = { kind: "turnComplete" };
    emit(state, {
      type: "playerRetreated",
      playerId: loser.id,
      from: positionBefore,
      to: loser.position,
    });
    addHistory(state, `${loser.name}无法支付惩罚，后退 3 格。`);
    return;
  }

  state.phase = {
    kind: "pvpPenalty",
    penalty: { winnerId, loserId, tileIndex: state.players[state.activePlayerId].position },
  };
  addHistory(state, `${winner.name}赢得相遇战，${loser.name}需要选择代价。`);
}

/**
 * PvE / Boss 战中 a 侧的临时生命值就是真实生命值，直接同步。
 * 这里刻意不发 playerHpChanged——变化已经由 battleDamage 描述，
 * 界面按 targetSide 映射回玩家即可，避免同一次掉血产生两条事件。
 */
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
    ? consumeScroll(state, state.players[attackerId], attackScrollId, "might")
    : false;
  const defenseBoost = defenderId
    ? consumeScroll(state, state.players[defenderId], defenseScrollId, "guard")
    : false;
  const attackRoll = rollDie(state);
  const defenseRoll = rollDie(state);
  const attackBase = sideStats(state, battle, attackerSide).attack;
  const defenseBase = sideStats(state, battle, defenderSide).defense;
  const attackBonus = attackBoost ? 3 : 0;
  const defenseBonus = defenseBoost ? 3 : 0;
  const attackTotal = attackBase + attackRoll + attackBonus;
  const defenseTotal = defenseBase + defenseRoll + defenseBonus;
  const damage = Math.max(0, attackTotal - defenseTotal);

  emit(state, {
    type: "attackRolled",
    side: attackerSide,
    die: attackRoll,
    base: attackBase,
    scrollBonus: attackBonus,
    total: attackTotal,
  });
  emit(state, {
    type: "defenseRolled",
    side: defenderSide,
    die: defenseRoll,
    base: defenseBase,
    scrollBonus: defenseBonus,
    total: defenseTotal,
  });

  const hpBefore = defenderSide === "a" ? battle.hpA : battle.hpB;
  if (defenderSide === "a") battle.hpA = Math.max(0, battle.hpA - damage);
  else battle.hpB = Math.max(0, battle.hpB - damage);
  const hpAfter = defenderSide === "a" ? battle.hpA : battle.hpB;
  emit(state, {
    type: "battleDamage",
    targetSide: defenderSide,
    amount: damage,
    hpBefore,
    hpAfter,
    hpMax: sideMaxHp(state, battle, defenderSide),
  });

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
      emit(state, {
        type: "battleEnded",
        battleKind: battle.kind,
        outcome: "pvpDecided",
        winnerSide: attackerSide,
      });
      finishPvp(state, battle, attackerSide);
      return;
    }
    if (defenderSide === "b") {
      emit(state, {
        type: "battleEnded",
        battleKind: battle.kind,
        outcome: "playerWon",
        winnerSide: "a",
      });
      const player = state.players[battle.aPlayerId];
      if (battle.kind === "boss") {
        state.phase = { kind: "gameOver", winnerId: player.id };
        emit(state, { type: "gameOver", winnerId: player.id });
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

    emit(state, {
      type: "battleEnded",
      battleKind: battle.kind,
      outcome: "playerLost",
      winnerSide: "b",
    });
    const player = state.players[battle.aPlayerId];
    const hpBeforeRecovery = player.hp;
    const positionBefore = player.position;
    player.hp = Math.ceil(player.maxHp / 2);
    const retreat = [...REST_TILES].reverse().find((index) => index < player.position) ?? 0;
    player.position = retreat;
    emit(state, {
      type: "playerHpChanged",
      playerId: player.id,
      from: hpBeforeRecovery,
      to: player.hp,
      maxHp: player.maxHp,
      reason: "defeatRecovery",
    });
    emit(state, {
      type: "playerRetreated",
      playerId: player.id,
      from: positionBefore,
      to: retreat,
    });
    state.phase = { kind: "turnComplete" };
    addHistory(state, `${player.name}战败，恢复至半血并退回休整点。`);
    return;
  }

  battle.attacker = defenderSide;
  battle.round += 1;
  emit(state, {
    type: "battleRoundAdvanced",
    round: battle.round,
    attacker: defenderSide,
  });
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
    const loserBefore = loser.hp;
    const winnerBefore = winner.hp;
    loser.hp -= amount;
    winner.hp += amount;
    emit(state, {
      type: "playerHpChanged",
      playerId: loser.id,
      from: loserBefore,
      to: loser.hp,
      maxHp: loser.maxHp,
      reason: "pvpTransfer",
    });
    emit(state, {
      type: "playerHpChanged",
      playerId: winner.id,
      from: winnerBefore,
      to: winner.hp,
      maxHp: winner.maxHp,
      reason: "pvpTransfer",
    });
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
    emit(state, {
      type: "scrollTransferred",
      fromId: loser.id,
      toId: winner.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
  } else {
    const item = removeEquipmentStats(state, loser, action.instanceId);
    if (!item) return;
    emit(state, {
      type: "equipmentTransferred",
      fromId: loser.id,
      toId: winner.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
    applyEquipmentStats(state, winner, item);
  }
  addHistory(state, `${loser.name}交出一件资源给${winner.name}。`);
  finishPenaltyAndResolveTile(state, tileIndex);
}

/**
 * 让新开一局的事件 id 接着上一局往后排。
 *
 * 播放队列靠“id 水位线”给事件去重，而 createInitialGame 每次都从 1 开始。
 * 如果重开后的 id 与上一局重叠，新开局的事件就会被当成重复丢掉。
 * 保证整个会话内 id 单调递增，去重逻辑才始终成立。
 */
function rebaseEventIds(state: GameState, startId: number): GameState {
  const offset = startId - 1;
  if (offset <= 0) return state;
  state.lastEvents = state.lastEvents.map((event) => ({ ...event, id: event.id + offset }));
  state.nextEventId += offset;
  return state;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "restart") {
    return rebaseEventIds(createInitialGame(action.seed), state.nextEventId);
  }
  const next = structuredClone(state);
  next.lastEvents = [];

  switch (action.type) {
    case "rollMovement": {
      if (next.phase.kind !== "awaitingRoll") return state;
      const player = next.players[next.activePlayerId];
      const roll = rollDie(next);
      next.lastMovementRoll = roll;
      const positionBefore = player.position;
      player.position = Math.min(MAP.length - 1, player.position + roll);
      emit(next, { type: "movementRolled", playerId: player.id, value: roll });
      emit(next, {
        type: "playerMoved",
        playerId: player.id,
        from: positionBefore,
        to: player.position,
      });
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
      emit(next, {
        type: "turnStarted",
        playerId: next.activePlayerId,
        turn: next.turn,
      });
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

export function getSidePlayer(state: GameState, battle: BattleState, side: CombatSide) {
  const id = battlePlayerForSide(battle, side);
  return id ? state.players[id] : undefined;
}

export { MAP, PLAYER_IDS };
