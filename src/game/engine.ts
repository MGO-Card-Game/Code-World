import {
  EQUIPMENT,
  EQUIPMENT_SLOT_LIMITS,
  HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS,
  equipmentCategory,
  equipmentDefinition,
  pickEquipmentKind,
} from "./content/equipment";
import {
  mapEventDefinition,
  pickMapEvent,
  type MapEventEffectDefinition,
  type MapEventResource,
} from "./content/events";
import { pickScrollKind, SCROLLS, scrollDefinition } from "./content/scrolls";
import { findPreviousRestTile, findRestTileAtOrBefore, generateMap } from "./map";
import {
  enemyDiceCountBonus,
  enemyDieSidesBonus,
  enemyEffects,
  enemyStats,
  getAttack,
  getDefense,
  getDiceCountBonus,
  getDieSidesBonus,
  playableScrolls,
  pvpHpTransferAmount,
} from "./selectors";
import type {
  BattleHookContext,
  EnemyEffects,
  RollModifiers,
  RollResult,
} from "./effects/battleHooks";
import type {
  EquipmentBattleContext,
  EquipmentEffects,
  ScrollEffectDefinition,
} from "./effects/cardEffects";
import type {
  BattleState,
  CombatSide,
  EliteAffixKind,
  EnemyKind,
  EquipmentKind,
  GameAction,
  GameEvent,
  GameEventBody,
  GameState,
  LogEntry,
  MapTile,
  OwnedEquipment,
  OwnedScroll,
  Player,
  PlayerId,
  PlayerStats,
  ScrollChoice,
  ScrollKind,
  ScrollTiming,
} from "./types";

const PLAYER_IDS: PlayerId[] = ["player1", "player2"];

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

/**
 * 记录一条旁白。
 *
 * secret 用于暗牌：只有 owner 看得到 text，其他人由 viewFor 换成 publicText。
 * 抽卡类文案必须带上它，否则「获得力量卷轴」这一句会让裁剪手牌数组白做。
 */
function addHistory(
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

function makeInstanceId(state: GameState, prefix: string) {
  const id = `${prefix}-${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return id;
}

/**
 * 一次奖励的两种说法。
 *
 * 卷轴是暗牌，旁观者只该知道「获得了一张卷轴」；装备是公开的，两者相同。
 * 让奖励自己带上这两种说法，而不是让调用方去猜这次给的是不是卷轴。
 */
interface Reward {
  name: string;
  publicName: string;
  pendingEquipmentChoice?: boolean;
}

function grantScroll(state: GameState, player: Player, kind?: ScrollKind): Reward {
  const selected = kind ?? pickScrollKind(() => nextRandom(state));
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
  return {
    name: SCROLLS[selected].name,
    publicName: "一张卷轴",
  };
}

/** 宝箱与非 Boss 战斗共用的资源奖励：卷轴、装备各 50%。 */
function grantRandomResourceReward(state: GameState, player: Player): Reward {
  return rollDie(state, 2) === 1
    ? grantScroll(state, player)
    : grantEquipment(state, player);
}

/** 按奖励是否需要保密，拼出 addHistory 的第三个参数 */
function rewardSecret(player: Player, template: (what: string) => string, reward: Reward) {
  if (reward.name === reward.publicName) return undefined;
  return { owner: player.id, publicText: template(reward.publicName) };
}

function equipmentMaxHp(item: OwnedEquipment) {
  return EQUIPMENT[item.kind].modifiers
    .filter((effect) => effect.type === "maxHp")
    .reduce((sum, effect) => sum + effect.value, 0);
}

function runEquipmentHook(
  hook: "onEquip" | "onUnequip",
  state: GameState,
  player: Player,
  item: OwnedEquipment,
) {
  equipmentDefinition(item.kind).effects?.[hook]?.({ state, player, item });
}

/** 只负责装备入槽和属性联动；调用方决定发哪一种获得/转移事件。 */
function applyEquipmentStats(
  state: GameState,
  player: Player,
  item: OwnedEquipment,
) {
  player.equipment.push(item);
  const maxHpBonus = equipmentMaxHp(item);
  runEquipmentHook("onEquip", state, player, item);
  if (maxHpBonus === 0) return;
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp += maxHpBonus;
  player.hp = Math.min(player.maxHp, player.hp + maxHpBonus);
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
    reason: "equipment",
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
  const maxHpBonus = equipmentMaxHp(item);
  runEquipmentHook("onUnequip", state, player, item);
  if (maxHpBonus !== 0) {
    const maxHpBefore = player.maxHp;
    const hpBefore = player.hp;
    player.maxHp -= maxHpBonus;
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
        reason: "equipment",
      });
    }
  }
  return item;
}

function equipmentInCategory(player: Player, kind: EquipmentKind) {
  const category = equipmentCategory(kind);
  return player.equipment.filter((item) => equipmentCategory(item.kind) === category);
}

function hasFreeEquipmentSlot(player: Player, kind: EquipmentKind) {
  const category = equipmentCategory(kind);
  return equipmentInCategory(player, kind).length < EQUIPMENT_SLOT_LIMITS[category];
}

function grantEquipment(
  state: GameState,
  player: Player,
  selectedKind?: EquipmentKind,
): Reward {
  const kind = selectedKind ?? pickEquipmentKind(() => nextRandom(state));
  const item: OwnedEquipment = {
    instanceId: makeInstanceId(state, "equipment"),
    kind,
  };
  const name = EQUIPMENT[kind].name;
  if (!hasFreeEquipmentSlot(player, kind)) {
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: player.id,
        offered: item,
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };
    return { name, publicName: name, pendingEquipmentChoice: true };
  }
  emit(state, {
    type: "equipmentGranted",
    playerId: player.id,
    instanceId: item.instanceId,
    kind,
  });
  applyEquipmentStats(state, player, item);
  return { name, publicName: name };
}

function grantMapEventResource(
  state: GameState,
  player: Player,
  resource: MapEventResource,
) {
  switch (resource) {
    case "scroll":
      return grantScroll(state, player);
    case "equipment":
      return grantEquipment(state, player);
    case "random":
      return grantRandomResourceReward(state, player);
  }
}

/**
 * 结算一条声明式地图事件效果；返回 true 表示装备槽选择暂停了后续即时效果。
 */
function applyMapEventEffect(
  state: GameState,
  player: Player,
  effect: MapEventEffectDefinition,
) {
  switch (effect.type) {
    case "heal": {
      const hpBefore = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + Math.max(0, effect.amount));
      const amount = player.hp - hpBefore;
      if (amount > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "event",
        });
      }
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "damage": {
      const hpBefore = player.hp;
      const minimumHp = Math.max(0, Math.min(player.hp, effect.minimumHp ?? 1));
      player.hp = Math.max(minimumHp, player.hp - Math.max(0, effect.amount));
      const amount = hpBefore - player.hp;
      if (amount > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "event",
        });
      }
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "grantResource": {
      const reward = grantMapEventResource(state, player, effect.resource);
      const line = (rewardName: string) => effect.narration({
        playerName: player.name,
        rewardName,
      });
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return reward.pendingEquipmentChoice === true;
    }
    case "increaseBaseStat": {
      const key = effect.stat === "attack" ? "baseAttack" : "baseDefense";
      const from = player[key];
      player[key] += Math.max(0, effect.amount);
      const amount = player[key] - from;
      if (amount > 0) {
        emit(state, {
          type: "baseStatChanged",
          playerId: player.id,
          stat: effect.stat,
          from,
          to: player[key],
        });
      }
      addHistory(state, effect.narration({
        playerName: player.name,
        stat: effect.stat,
        amount,
      }));
      return false;
    }
    case "grantEquipment": {
      const kind = pickEquipmentKind(
        () => nextRandom(state),
        {
          category: effect.category,
          rarityWeights: effect.quality === "high"
            ? HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS
            : undefined,
        },
      );
      const reward = grantEquipment(state, player, kind);
      const line = (rewardName: string) => effect.narration({
        playerName: player.name,
        rewardName,
      });
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return reward.pendingEquipmentChoice === true;
    }
  }
}

function resolveRandomMapEvent(state: GameState, player: Player, region: MapTile["region"]) {
  const kind = pickMapEvent(region, () => nextRandom(state));
  const definition = mapEventDefinition(kind);
  state.phase = { kind: "turnComplete" };
  for (const effect of definition.effects) {
    if (applyMapEventEffect(state, player, effect)) break;
  }
}

/** 折算过词缀的敌方属性。b 侧是玩家时不该调用。 */
function battleEnemyStats(battle: BattleState) {
  return enemyStats(battle.enemyId!, battle.enemyAffix);
}

function combatantName(state: GameState, battle: BattleState, side: CombatSide) {
  if (side === "a") return state.players[battle.aPlayerId].name;
  if (battle.bPlayerId) return state.players[battle.bPlayerId].name;
  return battleEnemyStats(battle).name;
}

function startBattle(
  state: GameState,
  kind: BattleState["kind"],
  aPlayerId: PlayerId,
  enemyId?: EnemyKind,
  bPlayerId?: PlayerId,
  enemyAffix?: EliteAffixKind,
) {
  emit(state, {
    type: "battleStarted",
    battleKind: kind,
    aPlayerId,
    bPlayerId,
    enemyId,
    enemyAffix,
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
    enemyAffix,
    retreatTo: kind === "pvp"
      ? undefined
      : findRestTileAtOrBefore(
          state.map,
          state.movementOrigin ?? state.players[aPlayerId].position,
        ),
    hpA: state.players[aPlayerId].hp,
    // 精英词缀会抬高血量上限，所以这里必须走折算，不能直接读定义
    hpB: bPlayerId ? state.players[bPlayerId].hp : enemyStats(enemyId!, enemyAffix).maxHp,
    attacker: initiativeA > initiativeB ? "a" : "b",
    initiativeA,
    initiativeB,
    round: 1,
    log: [],
    choiceA: { status: "pending" },
    // 敌人不使用卷轴（GameRule 8.6），直接视为已提交
    choiceB: bPlayerId ? { status: "pending" } : { status: "declined" },
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
  applyEquipmentBattleStart(state, battle, "a");
  applyEquipmentBattleStart(state, battle, "b");
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
    case "elite":
      // 精英格和普通战斗格走同一条 PvE 结算，差别只在那只怪身上贴了词缀
      startBattle(state, "pve", player.id, tile.enemyId, undefined, tile.eliteAffix);
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
      const reward = grantRandomResourceReward(state, player);
      if (!reward.pendingEquipmentChoice) {
        state.phase = { kind: "turnComplete" };
      }
      const line = (what: string) => `${player.name}打开宝箱，获得${what}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return;
    }
    case "event": {
      resolveRandomMapEvent(state, player, tile.region);
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
) {
  if (!instanceId) return undefined;
  const index = player.scrolls.findIndex((scroll) => scroll.instanceId === instanceId);
  if (index < 0) return undefined;
  const [scroll] = player.scrolls.splice(index, 1);
  emit(state, {
    type: "scrollConsumed",
    playerId: player.id,
    instanceId,
    kind: scroll.kind,
  });
  return scroll.kind;
}

/**
 * 消耗本回合提交的全部卷轴。
 *
 * 刻意先把牌全部消耗掉，再去结算效果：中途有一张把对手打倒时，
 * 剩下的牌也已经打出去了，不该因为对面先死就退回手里。
 */
function consumeScrolls(
  state: GameState,
  player: Player,
  instanceIds: readonly string[],
): ScrollKind[] {
  const kinds: ScrollKind[] = [];
  for (const instanceId of instanceIds) {
    const kind = consumeScroll(state, player, instanceId);
    if (kind) kinds.push(kind);
  }
  return kinds;
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
  const enemy = battleEnemyStats(battle);
  return { attack: enemy.attack, defense: enemy.defense };
}

function sideHp(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.hpA : battle.hpB;
}

function sideMaxHp(state: GameState, battle: BattleState, side: CombatSide) {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) return state.players[playerId].maxHp;
  return battleEnemyStats(battle).maxHp;
}

/**
 * 相遇战选择"后退"时退多少格（GameRule 13.8）。
 *
 * 这一项存在的意义是让代价永远付得出：卷轴和装备可能一张都没有，
 * 转移生命可能因为赢家满血而为 0，只有后退在任何局面下都能执行。
 * 于是"进入代价阶段"与"有可付选项"变成同一件事，不需要再做例外分支。
 *
 * 数值上要比交牌更疼一点才有取舍——移动骰均值 3.5，退 5 格约等于一个半回合。
 * 太便宜的话所有人永远选后退，资源转移这条机制就废了。具体数字仍需实测调整。
 */
export const PVP_RETREAT_TILES = 5;

function finishPvp(state: GameState, battle: BattleState, winnerSide: CombatSide) {
  const winnerId = battlePlayerForSide(battle, winnerSide)!;
  const loserId = battlePlayerForSide(battle, winnerSide === "a" ? "b" : "a")!;
  const loser = state.players[loserId];
  const winner = state.players[winnerId];

  // 后退永远付得出，所以这里没有"付不起"的分支——代价阶段一定有路可走
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

function choiceFor(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.choiceA : battle.choiceB;
}

function setChoice(battle: BattleState, side: CombatSide, choice: ScrollChoice) {
  if (side === "a") battle.choiceA = choice;
  else battle.choiceB = choice;
}

/** 新一轮开始时重置双方选择；敌人一侧直接视为已提交 */
function resetChoices(battle: BattleState) {
  battle.choiceA = { status: "pending" };
  battle.choiceB = battle.bPlayerId ? { status: "pending" } : { status: "declined" };
}

function chosenInstanceIds(choice: ScrollChoice): readonly string[] {
  return choice.status === "chosen" ? choice.instanceIds : [];
}

function finishBattle(state: GameState, battle: BattleState, winnerSide: CombatSide) {
  // 先回收临时牌，再走任何分支——相遇战代价阶段会让败方交出一张卷轴
  dropTemporaryScrolls(state);
  clearBattleMemos(state);

  if (battle.kind === "pvp") {
    emit(state, {
      type: "battleEnded",
      battleKind: battle.kind,
      outcome: "pvpDecided",
      winnerSide,
    });
    finishPvp(state, battle, winnerSide);
    return;
  }

  if (winnerSide === "a") {
    emit(state, {
      type: "battleEnded",
      battleKind: battle.kind,
      outcome: "playerWon",
      winnerSide,
    });
    const player = state.players[battle.aPlayerId];
    if (battle.kind === "boss") {
      state.phase = { kind: "gameOver", winnerId: player.id };
      emit(state, { type: "gameOver", winnerId: player.id });
      addHistory(state, `${player.name}击败峰顶巨龙，夺得登峰之冠！`);
    } else {
      const reward = grantRandomResourceReward(state, player);
      if (!reward.pendingEquipmentChoice) {
        state.phase = { kind: "turnComplete" };
      }
      // 战报里用折算后的名字，精英怪才不会在这一句退回成普通怪
      const enemyName = battleEnemyStats(battle).name;
      const line = (what: string) => `${player.name}击败${enemyName}，获得${what}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
    }
    return;
  }

  emit(state, {
    type: "battleEnded",
    battleKind: battle.kind,
    outcome: "playerLost",
    winnerSide,
  });
  const player = state.players[battle.aPlayerId];
  const hpBeforeRecovery = player.hp;
  const positionBefore = player.position;
  player.hp = Math.ceil(player.maxHp / 2);
  // retreatTo 在开战时就按移动起点锁定，不能把本次掷骰途中越过的泉水算进去。
  // 回退分支兼容旧存档或测试中手工构造、尚未携带该字段的战斗状态。
  const retreat = battle.retreatTo ?? findPreviousRestTile(state.map, player.position);
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
}

/** 返回目标是否被卷轴直接击败。 */
function applyDirectScrollDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  rawDamage: number,
  effectName: string,
) {
  // 读取当前总防御（基础值 + 装备），但不投防御骰。
  const damage = Math.max(0, rawDamage - sideStats(state, battle, targetSide).defense);
  const hpBefore = targetSide === "a" ? battle.hpA : battle.hpB;
  if (targetSide === "a") battle.hpA = Math.max(0, battle.hpA - damage);
  else battle.hpB = Math.max(0, battle.hpB - damage);
  const hpAfter = targetSide === "a" ? battle.hpA : battle.hpB;
  emit(state, {
    type: "battleDamage",
    targetSide,
    amount: damage,
    hpBefore,
    hpAfter,
    hpMax: sideMaxHp(state, battle, targetSide),
  });
  battle.log.unshift(
    `${combatantName(state, battle, sourceSide)}使用${effectName}，${combatantName(state, battle, targetSide)}受到 ${damage} 点伤害。`,
  );
  battle.log = battle.log.slice(0, 8);
  syncPveHp(state, battle);
  return hpAfter <= 0;
}

function applyBattleHealing(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  amount: number,
  effectName: string,
) {
  const hpBefore = sideHp(battle, side);
  const hpMax = sideMaxHp(state, battle, side);
  const hpAfter = Math.min(hpMax, hpBefore + Math.max(0, amount));
  const healed = hpAfter - hpBefore;
  if (side === "a") battle.hpA = hpAfter;
  else battle.hpB = hpAfter;
  if (healed > 0) {
    emit(state, {
      type: "battleHealed",
      targetSide: side,
      amount: healed,
      hpBefore,
      hpAfter,
      hpMax,
    });
  }
  battle.log.unshift(
    `${combatantName(state, battle, side)}使用${effectName}，恢复 ${healed} 点生命。`,
  );
  battle.log = battle.log.slice(0, 8);
  syncPveHp(state, battle);
}

function newRollModifiers(): RollModifiers {
  return {
    flatBonus: 0,
    extraDice: 0,
    minimumRoll: 1,
    maxRollDice: 0,
    bonusDamage: 0,
  };
}

function applyScrollEffect(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  effectName: string,
  effect: ScrollEffectDefinition,
  modifiers: RollModifiers,
) {
  switch (effect.type) {
    case "flatBonus":
      modifiers.flatBonus += effect.value;
      return false;
    case "dieSides":
      /*
        取最大而不是后写覆盖。

        一回合可以打任意多张牌，两张换骰面的卷轴同时打出时，"谁生效"不能取决于
        提交顺序——那种依赖不会报错，只会让数值悄悄算错。取最大之后顺序在数学上
        就影响不了结果，也就不需要给每张卡维护优先级。
        rollModifiers.test.ts 有一条排列测试守着这个性质。
      */
      modifiers.sidesOverride = Math.max(modifiers.sidesOverride ?? 0, effect.sides);
      return false;
    case "extraDice":
      modifiers.extraDice += effect.count;
      return false;
    case "minimumRoll":
      modifiers.minimumRoll = Math.max(modifiers.minimumRoll, effect.value);
      return false;
    case "maxRoll":
      modifiers.maxRollDice += effect.count;
      return false;
    case "directDamage":
      return applyDirectScrollDamage(
        state,
        battle,
        sourceSide,
        targetSide,
        effect.amount,
        effectName,
      );
    case "heal":
      applyBattleHealing(state, battle, sourceSide, effect.amount, effectName);
      return false;
    case "forfeitMovement": {
      const playerId = battlePlayerForSide(battle, sourceSide);
      if (playerId) state.players[playerId].skipNextMovement = true;
      battle.log.unshift(
        `${combatantName(state, battle, sourceSide)}将在下一次地图行动中无法移动。`,
      );
      battle.log = battle.log.slice(0, 8);
      return false;
    }
    case "custom": {
      let targetDefeated = false;
      const result = effect.resolve({
        state,
        battle,
        sourceSide,
        targetSide,
        modifiers,
        dealDamage(rawDamage) {
          targetDefeated = applyDirectScrollDamage(
            state,
            battle,
            sourceSide,
            targetSide,
            rawDamage,
            effectName,
          );
          return targetDefeated;
        },
        addBattleLog(text) {
          battle.log.unshift(text);
          battle.log = battle.log.slice(0, 8);
        },
      });
      return targetDefeated || result?.targetDefeated === true;
    }
  }
}

function applyMapHealing(state: GameState, player: Player, amount: number) {
  const hpBefore = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + Math.max(0, amount));
  const healed = player.hp - hpBefore;
  if (healed > 0) {
    emit(state, {
      type: "playerHpChanged",
      playerId: player.id,
      from: hpBefore,
      to: player.hp,
      maxHp: player.maxHp,
      reason: "scroll",
    });
  }
  return healed;
}

/** 地图阶段使用疗牌；返回 false 时保持“非法动作不产生新状态”的约定。 */
function useMapScroll(state: GameState, instanceId: string) {
  if (state.phase.kind !== "awaitingRoll" && state.phase.kind !== "turnComplete") {
    return false;
  }
  const player = state.players[state.activePlayerId];
  const owned = player.scrolls.find((scroll) => scroll.instanceId === instanceId);
  if (!owned) return false;
  const definition = scrollDefinition(owned.kind);
  if (!definition.timings.includes("map")) return false;
  const supported = definition.effects.every(
    (effect) => effect.type === "heal" || effect.type === "forfeitMovement",
  );
  if (!supported) return false;
  const forfeitsMovement = definition.effects.some(
    (effect) => effect.type === "forfeitMovement",
  );
  // 已经移动完再喝药无法支付“本回合不能移动”的代价。
  if (forfeitsMovement && state.phase.kind === "turnComplete") return false;
  const canHeal = definition.effects.some(
    (effect) => effect.type === "heal" && effect.amount > 0,
  );
  if (canHeal && player.hp >= player.maxHp) return false;

  consumeScroll(state, player, instanceId);
  let healed = 0;
  for (const effect of definition.effects) {
    if (effect.type === "heal") healed += applyMapHealing(state, player, effect.amount);
  }
  if (forfeitsMovement) state.phase = { kind: "turnComplete" };
  addHistory(
    state,
    `${player.name}使用${definition.name}，恢复 ${healed} 点生命${forfeitsMovement ? "，本回合不再移动" : ""}。`,
  );
  return true;
}

/**
 * 依次结算本侧本回合打出的全部卷轴，返回目标是否已被打倒。
 *
 * 按提交顺序走，目标一倒就停手——后面的牌已经消耗掉了，只是效果不再结算。
 * 累加类效果（加值、骰数、骰面）与顺序无关，只有 directDamage / custom
 * 这类带副作用的会受顺序影响，见 RollModifiers 的说明。
 */
function applyScrollEffects(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  kinds: readonly ScrollKind[],
  modifiers: RollModifiers,
) {
  for (const kind of kinds) {
    const definition = SCROLLS[kind];
    for (const effect of definition.effects) {
      if (
        applyScrollEffect(
          state,
          battle,
          sourceSide,
          targetSide,
          definition.name,
          effect,
          modifiers,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function rollForSide(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
) {
  const playerId = battlePlayerForSide(battle, side);
  const player = playerId ? state.players[playerId] : undefined;
  /*
    玩家的修正来自装备，敌人的来自本体与精英词缀。这里以前只有玩家分支，
    "没有玩家"直接等同于"没有任何修正"——那样「迅捷的」这类词缀会静默失效，
    不报错也不掉日志，只是骰子少投一颗。enemyBattleHooks.test.ts 盯着这一点。
  */
  const sidesBonus = player
    ? getDieSidesBonus(player, dieKind)
    : enemyDieSidesBonus(battle.enemyId!, battle.enemyAffix, dieKind);
  const countBonus = player
    ? getDiceCountBonus(player, dieKind)
    : enemyDiceCountBonus(battle.enemyId!, battle.enemyAffix, dieKind);
  const sides = Math.max(2, (modifiers.sidesOverride ?? 6) + sidesBonus);
  const count = Math.max(1, 1 + modifiers.extraDice + countBonus);
  /*
    每颗骰子都照常掷一次再决定要不要覆盖，而不是"视为最高面就跳过投骰"。
    这样消耗的随机数个数只取决于骰子数量，与本次生效了哪些效果无关，
    同种子重放和对照调试才不会因为多了一张牌就整条随机流错位。
  */
  const dice = Array.from({ length: count }, (_unused, index) => {
    const roll = Math.min(sides, Math.max(modifiers.minimumRoll, rollDie(state, sides)));
    return index < modifiers.maxRollDice ? sides : roll;
  });
  return {
    sides,
    dice,
    sum: dice.reduce((total, die) => total + die, 0),
  };
}

/**
 * 遍历该侧玩家身上带自定义效果的装备。
 * 敌人一侧没有玩家，自然也没有装备，直接跳过。
 */
function forEachEquipmentEffects(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  visit: (effects: EquipmentEffects, item: OwnedEquipment, player: Player) => void,
) {
  const playerId = battlePlayerForSide(battle, side);
  if (!playerId) return;
  const player = state.players[playerId];
  // 复制一份：钩子理论上可以改动装备列表，遍历时被改会漏掉后面的装备
  for (const item of [...player.equipment]) {
    const effects = equipmentDefinition(item.kind).effects;
    if (effects) visit(effects, item, player);
  }
}

/** 装备与怪物共用的那半份上下文。 */
function battleHookContext(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
): BattleHookContext {
  return {
    state,
    battle,
    side,
    opponentSide,
    dieKind,
    modifiers,
    ownHp: sideHp(battle, side),
    ownMaxHp: sideMaxHp(state, battle, side),
    opponentHp: sideHp(battle, opponentSide),
    opponentMaxHp: sideMaxHp(state, battle, opponentSide),
    addBattleLog(text) {
      battle.log.unshift(text);
      battle.log = battle.log.slice(0, 8);
    },
  };
}

function equipmentBattleContext(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
  player: Player,
  item: OwnedEquipment,
): EquipmentBattleContext {
  return {
    ...battleHookContext(state, battle, side, opponentSide, dieKind, modifiers),
    player,
    item,
  };
}

/**
 * 遍历该侧敌人的效果：本体的，加上精英词缀的。
 * 该侧是玩家时没有敌人，直接跳过——正好和 forEachEquipmentEffects 互补。
 */
function forEachEnemyEffects(
  battle: BattleState,
  side: CombatSide,
  visit: (effects: EnemyEffects) => void,
) {
  if (battlePlayerForSide(battle, side)) return;
  for (const effects of enemyEffects(battle.enemyId!, battle.enemyAffix)) {
    visit(effects);
  }
}

/**
 * 战斗开始时的装备钩子，目前用于发临时牌。
 *
 * 发出去的牌带 temporary 标记，由 dropTemporaryScrolls 在战斗结束时回收。
 */
function applyEquipmentBattleStart(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
) {
  forEachEquipmentEffects(state, battle, side, (effects, item, player) => {
    effects.onBattleStart?.({
      state,
      battle,
      side,
      player,
      item,
      grantBattleScroll(kind) {
        const scroll: OwnedScroll = {
          instanceId: makeInstanceId(state, "battle-scroll"),
          kind,
          temporary: true,
        };
        player.scrolls.push(scroll);
        emit(state, {
          type: "scrollGranted",
          playerId: player.id,
          instanceId: scroll.instanceId,
          kind,
        });
      },
    });
  });
}

/**
 * 回收本场战斗发出的临时牌。
 *
 * 必须在任何阶段切换**之前**调用——尤其是相遇战代价阶段：那里败方可以交出
 * 一张卷轴，临时牌要是还在手上就会被交给赢家，凭空变成一张常驻卡。
 */
function dropTemporaryScrolls(state: GameState) {
  for (const player of Object.values(state.players)) {
    player.scrolls = player.scrolls.filter((scroll) => !scroll.temporary);
  }
}

/**
 * 清空全部装备的战斗内暗格（`OwnedEquipment.battleMemo`）。
 *
 * 和临时牌一起在 finishBattle 开头回收。暗格记的是"上一回合"，跨场留着的话
 * 下一场第一轮就会把上一场最后一轮当成前一轮用——断星剑会白送一颗骰子。
 * 放在引擎里而不是让每张卡在 onBattleStart 自己清：漏清不报错、不掉日志，
 * 只是效果偶尔多触发一次，是最难发现的那类 bug。
 */
function clearBattleMemos(state: GameState) {
  for (const player of Object.values(state.players)) {
    for (const item of player.equipment) delete item.battleMemo;
  }
}

/** 掷骰前的装备钩子。卷轴先结算完才轮到这里，见 EquipmentEffects。 */
function applyEquipmentBeforeRoll(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
) {
  forEachEquipmentEffects(state, battle, side, (effects, item, player) => {
    effects.beforeRoll?.(
      equipmentBattleContext(
        state, battle, side, opponentSide, dieKind, modifiers, player, item,
      ),
    );
  });
}

/** 掷骰后的装备钩子，能读到骰面结果。 */
function applyEquipmentAfterRoll(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
  roll: RollResult,
) {
  forEachEquipmentEffects(state, battle, side, (effects, item, player) => {
    effects.afterRoll?.({
      ...equipmentBattleContext(
        state, battle, side, opponentSide, dieKind, modifiers, player, item,
      ),
      roll,
    });
  });
}

/** 掷骰前的怪物钩子，与装备钩子在流程里同一位置。 */
function applyEnemyBeforeRoll(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
) {
  forEachEnemyEffects(battle, side, (effects) => {
    effects.beforeRoll?.(
      battleHookContext(state, battle, side, opponentSide, dieKind, modifiers),
    );
  });
}

/** 掷骰后的怪物钩子，能读到骰面结果。 */
function applyEnemyAfterRoll(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
  roll: RollResult,
) {
  forEachEnemyEffects(battle, side, (effects) => {
    effects.afterRoll?.({
      ...battleHookContext(state, battle, side, opponentSide, dieKind, modifiers),
      roll,
    });
  });
}

function resolveBattleRound(state: GameState) {
  if (state.phase.kind !== "battle") return;
  const battle = state.phase.battle;
  const attackerSide = battle.attacker;
  const defenderSideForChoice: CombatSide = attackerSide === "a" ? "b" : "a";
  const attackScrollIds = chosenInstanceIds(choiceFor(battle, attackerSide));
  const defenseScrollIds = chosenInstanceIds(choiceFor(battle, defenderSideForChoice));
  const defenderSide = attackerSide === "a" ? "b" : "a";
  const attackerId = battlePlayerForSide(battle, attackerSide);
  const defenderId = battlePlayerForSide(battle, defenderSide);
  const attackScrollKinds = attackerId
    ? consumeScrolls(state, state.players[attackerId], attackScrollIds)
    : [];
  const attackModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    attackerSide,
    defenderSide,
    attackScrollKinds,
    attackModifiers,
  )) {
    finishBattle(state, battle, attackerSide);
    return;
  }

  const defenseScrollKinds = defenderId
    ? consumeScrolls(state, state.players[defenderId], defenseScrollIds)
    : [];
  const defenseModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    defenderSide,
    attackerSide,
    defenseScrollKinds,
    defenseModifiers,
  )) {
    finishBattle(state, battle, defenderSide);
    return;
  }
  applyEquipmentBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  );
  applyEquipmentBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  );
  applyEnemyBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  );
  applyEnemyBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  );

  const attackRoll = rollForSide(
    state,
    battle,
    attackerSide,
    "attack",
    attackModifiers,
  );
  const defenseRoll = rollForSide(
    state,
    battle,
    defenderSide,
    "defense",
    defenseModifiers,
  );

  // 在读 flatBonus 之前调用，掷骰后的钩子改加值仍算进本次合计
  applyEquipmentAfterRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers, attackRoll,
  );
  applyEquipmentAfterRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers, defenseRoll,
  );
  applyEnemyAfterRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers, attackRoll,
  );
  applyEnemyAfterRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers, defenseRoll,
  );

  const attackBase = sideStats(state, battle, attackerSide).attack;
  const defenseBase = sideStats(state, battle, defenderSide).defense;
  const attackBonus = attackModifiers.flatBonus;
  const defenseBonus = defenseModifiers.flatBonus;
  const attackTotal = attackBase + attackRoll.sum + attackBonus;
  const defenseTotal = defenseBase + defenseRoll.sum + defenseBonus;
  // bonusDamage 是攻防差之外的追加伤害，防御挡不住它
  const damage = Math.max(0, attackTotal - defenseTotal) + attackModifiers.bonusDamage;

  emit(state, {
    type: "attackRolled",
    side: attackerSide,
    die: attackRoll.sum,
    dice: attackRoll.dice,
    sides: attackRoll.sides,
    base: attackBase,
    flatBonus: attackBonus,
    total: attackTotal,
  });
  emit(state, {
    type: "defenseRolled",
    side: defenderSide,
    die: defenseRoll.sum,
    dice: defenseRoll.dice,
    sides: defenseRoll.sides,
    base: defenseBase,
    flatBonus: defenseBonus,
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
    finishBattle(state, battle, attackerSide);
    return;
  }

  const previousRound = battle.round;
  battle.attacker = defenderSide;
  battle.round += 1;
  resetChoices(battle);
  emit(state, {
    type: "battleRoundAdvanced",
    round: battle.round,
    attacker: defenderSide,
    fromRound: previousRound,
    fromAttacker: attackerSide,
  });
  state.message = { text: `战斗第 ${battle.round} 轮：轮到${defenderName}攻击。` };
}

/**
 * 提交一侧的卷轴选择（GameRule 8.3）。
 *
 * 暗牌之下攻防双方在各自设备上独立决定，因此这里只记录选择；
 * 两侧都提交后才真正结算本回合。
 */
function submitScrollChoice(
  state: GameState,
  side: CombatSide,
  instanceIds?: readonly string[],
) {
  if (state.phase.kind !== "battle") return false;
  const battle = state.phase.battle;
  if (choiceFor(battle, side).status !== "pending") return false;

  const playerId = battlePlayerForSide(battle, side);
  if (!playerId) return false;

  const chosen = instanceIds ?? [];
  if (chosen.length > 0) {
    // 张数不限（8.5），但每张都得确实在手上、此刻打得出，且不能重复提交同一张
    const timing: ScrollTiming =
      side === battle.attacker ? "beforeAttackRoll" : "beforeDefenseRoll";
    const playable = new Set(
      playableScrolls(state.players[playerId], timing).map((scroll) => scroll.instanceId),
    );
    if (new Set(chosen).size !== chosen.length) return false;
    if (chosen.some((id) => !playable.has(id))) return false;
    setChoice(battle, side, { status: "chosen", instanceIds: [...chosen] });
  } else {
    setChoice(battle, side, { status: "declined" });
  }

  if (battle.choiceA.status !== "pending" && battle.choiceB.status !== "pending") {
    resolveBattleRound(state);
  }
  return true;
}

function finishPenaltyAndResolveTile(state: GameState, tileIndex: number) {
  resolveTile(state, state.map.tiles[tileIndex], false);
}

function resumeAfterEquipmentChoice(
  state: GameState,
  resume: Extract<GameState["phase"], { kind: "equipmentChoice" }>["choice"]["resume"],
) {
  if (resume.kind === "turnComplete") {
    state.phase = { kind: "turnComplete" };
    return;
  }
  resolveTile(state, state.map.tiles[resume.tileIndex], false);
}

/** 装备槽满时，由获得装备的玩家选择替换同类装备，或放弃新装备。 */
function chooseEquipment(
  state: GameState,
  replaceInstanceId?: string,
) {
  if (state.phase.kind !== "equipmentChoice") return false;
  const choice = state.phase.choice;
  const player = state.players[choice.playerId];
  const offered = choice.offered;
  const offeredDefinition = EQUIPMENT[offered.kind];

  if (!replaceInstanceId) {
    addHistory(state, `${player.name}放弃了${offeredDefinition.name}。`);
    resumeAfterEquipmentChoice(state, choice.resume);
    return true;
  }

  const existing = player.equipment.find(
    (item) => item.instanceId === replaceInstanceId,
  );
  if (
    !existing ||
    equipmentCategory(existing.kind) !== equipmentCategory(offered.kind)
  ) {
    return false;
  }

  const removed = removeEquipmentStats(state, player, existing.instanceId);
  if (!removed) return false;
  if (choice.source === "reward") {
    emit(state, {
      type: "equipmentGranted",
      playerId: player.id,
      instanceId: offered.instanceId,
      kind: offered.kind,
    });
  }
  applyEquipmentStats(state, player, offered);
  addHistory(
    state,
    `${player.name}用${offeredDefinition.name}替换了${EQUIPMENT[removed.kind].name}。`,
  );
  resumeAfterEquipmentChoice(state, choice.resume);
  return true;
}

function choosePvpPenalty(
  state: GameState,
  action: Extract<GameAction, { type: "choosePvpPenalty" }>,
) {
  if (state.phase.kind !== "pvpPenalty") return false;
  const { winnerId, loserId, tileIndex } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];

  if (action.choice === "retreat") {
    const positionBefore = loser.position;
    loser.position = Math.max(0, loser.position - PVP_RETREAT_TILES);
    emit(state, {
      type: "playerRetreated",
      playerId: loser.id,
      from: positionBefore,
      to: loser.position,
    });
    addHistory(state, `${loser.name}选择后退 ${positionBefore - loser.position} 格。`);
    // 退走的人如果正是本回合行动的人，他已经不站在那格上了，格子内容自然不该结算
    if (loser.id === state.activePlayerId) {
      state.phase = { kind: "turnComplete" };
    } else {
      finishPenaltyAndResolveTile(state, tileIndex);
    }
    return true;
  }

  if (action.choice === "hp") {
    const amount = pvpHpTransferAmount(winner, loser);
    // 付不出就忽略这次提交，阶段留在原地让他重选。
    // 界面本来就不会画出这个按钮（同一个函数算的），走到这里说明是客户端越权，
    // 而后退永远可选，所以忽略不会造成死局。
    if (amount <= 0) return false;
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
    return true;
  }

  if (!action.instanceId || !action.resourceType) return false;
  if (action.resourceType === "scroll") {
    const index = loser.scrolls.findIndex((item) => item.instanceId === action.instanceId);
    if (index < 0) return false;
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
    if (!item) return false;
    emit(state, {
      type: "equipmentTransferred",
      fromId: loser.id,
      toId: winner.id,
      instanceId: item.instanceId,
      kind: item.kind,
    });
    if (!hasFreeEquipmentSlot(winner, item.kind)) {
      state.phase = {
        kind: "equipmentChoice",
        choice: {
          playerId: winner.id,
          offered: item,
          source: "transfer",
          resume: { kind: "resolveTile", tileIndex },
        },
      };
      addHistory(
        state,
        `${loser.name}交出${EQUIPMENT[item.kind].name}；${winner.name}需要选择是否替换同类装备。`,
      );
      return true;
    }
    applyEquipmentStats(state, winner, item);
  }
  addHistory(state, `${loser.name}交出一件资源给${winner.name}。`);
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
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

/**
 * 应用一个动作。
 *
 * **约定：动作没被接受时原样返回传入的 state 对象。** 调用方靠引用相等就能判断
 * 「这次提交被拒了」——服务器据此回一条错误而不是广播一个没变化的状态，
 * React 那边则直接跳过重渲染。
 *
 * 合法性判断只写在引擎里这一处。联机层的 canAct 只管授权（阶段、归属、是否已提交），
 * 不重复规则；两者职责分开，规则才不会出现第二份副本。
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "restart") {
    return rebaseEventIds(createInitialGame(action.seed, {
      player1: state.players.player1.name,
      player2: state.players.player2.name,
    }), state.nextEventId);
  }
  const next = structuredClone(state);
  next.lastEvents = [];

  switch (action.type) {
    case "rollMovement": {
      if (next.phase.kind !== "awaitingRoll") return state;
      const player = next.players[next.activePlayerId];
      const sides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
      const roll = rollDie(next, sides);
      next.lastMovementRoll = roll;
      const positionBefore = player.position;
      next.movementOrigin = positionBefore;
      player.position = Math.min(next.map.tiles.length - 1, player.position + roll);
      emit(next, {
        type: "movementRolled",
        playerId: player.id,
        value: roll,
        sides,
      });
      emit(next, {
        type: "playerMoved",
        playerId: player.id,
        from: positionBefore,
        to: player.position,
      });
      const targetTile = next.map.tiles[player.position];
      addHistory(next, `${player.name}掷出 ${roll}，抵达「${targetTile.label}」。`);
      resolveTile(next, targetTile);
      return next;
    }
    case "useMapScroll":
      return useMapScroll(next, action.instanceId) ? next : state;
    case "endTurn": {
      if (next.phase.kind !== "turnComplete") return state;
      next.activePlayerId = otherPlayer(next.activePlayerId);
      next.turn += 1;
      next.lastMovementRoll = undefined;
      next.movementOrigin = undefined;
      const incoming = next.players[next.activePlayerId];
      if (incoming.skipNextMovement) {
        delete incoming.skipNextMovement;
        next.phase = { kind: "turnComplete" };
      } else {
        next.phase = { kind: "awaitingRoll" };
      }
      emit(next, {
        type: "turnStarted",
        playerId: next.activePlayerId,
        turn: next.turn,
      });
      addHistory(
        next,
        next.phase.kind === "turnComplete"
          ? `${incoming.name}受战地药剂影响，本回合无法移动。`
          : `轮到${incoming.name}行动。`,
      );
      return next;
    }
    case "submitScrollChoice":
      return submitScrollChoice(next, action.side, action.instanceIds) ? next : state;
    case "choosePvpPenalty":
      return choosePvpPenalty(next, action) ? next : state;
    case "chooseEquipment":
      return chooseEquipment(next, action.replaceInstanceId) ? next : state;
  }
}

/**
 * 这两个查询只读玩家的非手牌字段，所以对 P 泛型化——
 * 传 GameState 得到 Player，传 GameStateView 得到 PlayerView，
 * 界面在本地与联机两种模式下都能复用，不必为暗牌视图另写一份。
 */
export function getBattleParticipants<P extends PlayerStats>(
  state: { players: Record<PlayerId, P> },
  battle: BattleState,
) {
  const a = state.players[battle.aPlayerId];
  // 敌人一侧交出折算后的属性而不是原始定义，界面才会显示「狂暴的山狼」
  // 和它真正的血量上限，不必自己再折一遍词缀。
  const b = battle.bPlayerId
    ? state.players[battle.bPlayerId]
    : battleEnemyStats(battle);
  return { a, b };
}

export function getSidePlayer<P extends PlayerStats>(
  state: { players: Record<PlayerId, P> },
  battle: BattleState,
  side: CombatSide,
): P | undefined {
  const id = battlePlayerForSide(battle, side);
  return id ? state.players[id] : undefined;
}

export { PLAYER_IDS };
