import { ENEMIES } from "./content/enemies";
import {
  EQUIPMENT,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
  equipmentDefinition,
  pickEquipmentKind,
} from "./content/equipment";
import { pickScrollKind, SCROLLS } from "./content/scrolls";
import { findPreviousRestTile, generateMap } from "./map";
import {
  getAttack,
  getDefense,
  getDiceCountBonus,
  getDieSidesBonus,
  playableScrolls,
} from "./selectors";
import { CUSTOM_EQUIPMENT_EFFECTS } from "./effects/customEquipmentEffects";
import { CUSTOM_SCROLL_EFFECTS } from "./effects/customScrollEffects";
import type {
  ScrollEffectDefinition,
  ScrollRollModifiers,
} from "./effects/cardEffects";
import type {
  BattleState,
  CombatSide,
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
  const normalized = normalizedSeed(seed);
  const state: GameState = {
    players: {
      player1: newPlayer("player1", "赤焰旅者", "#ff7a4d"),
      player2: newPlayer("player2", "苍潮旅者", "#55bde8"),
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
  const resolverId = equipmentDefinition(item.kind).customResolver;
  if (!resolverId) return;
  const resolver = CUSTOM_EQUIPMENT_EFFECTS[resolverId];
  if (!resolver) throw new Error(`装备效果解析器未注册：${resolverId}`);
  resolver[hook]?.({ state, player, item });
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

function grantEquipment(state: GameState, player: Player): Reward {
  const kind = pickEquipmentKind(() => nextRandom(state));
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
      if (!reward.pendingEquipmentChoice) {
        state.phase = { kind: "turnComplete" };
      }
      const line = (what: string) => `${player.name}打开宝箱，获得${what}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
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
        const reward = grantScroll(state, player);
        const line = (what: string) => `${player.name}从旅人手中获得${what}。`;
        addHistory(state, line(reward.name), rewardSecret(player, line, reward));
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

function chosenInstanceId(choice: ScrollChoice) {
  return choice.status === "chosen" ? choice.instanceId : undefined;
}

function finishBattle(state: GameState, battle: BattleState, winnerSide: CombatSide) {
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
      const enemy = ENEMIES[battle.enemyId!];
      const reward = enemy.reward === "equipment"
        ? grantEquipment(state, player)
        : grantScroll(state, player);
      if (!reward.pendingEquipmentChoice) {
        state.phase = { kind: "turnComplete" };
      }
      const line = (what: string) => `${player.name}击败${enemy.name}，获得${what}。`;
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
  const retreat = findPreviousRestTile(state.map, player.position);
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

function newRollModifiers(): ScrollRollModifiers {
  return {
    flatBonus: 0,
    extraDice: 0,
    minimumRoll: 1,
  };
}

function applyScrollEffect(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  effectName: string,
  effect: ScrollEffectDefinition,
  modifiers: ScrollRollModifiers,
) {
  switch (effect.type) {
    case "flatBonus":
      modifiers.flatBonus += effect.value;
      return false;
    case "dieSides":
      modifiers.sidesOverride = effect.sides;
      return false;
    case "extraDice":
      modifiers.extraDice += effect.count;
      return false;
    case "minimumRoll":
      modifiers.minimumRoll = Math.max(modifiers.minimumRoll, effect.value);
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
    case "custom": {
      const resolver = CUSTOM_SCROLL_EFFECTS[effect.resolver];
      if (!resolver) {
        throw new Error(`卷轴效果解析器未注册：${effect.resolver}`);
      }
      let targetDefeated = false;
      const result = resolver({
        state,
        battle,
        sourceSide,
        targetSide,
        modifiers,
        parameters: effect.parameters ?? {},
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

function applyScrollEffects(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  kind: ScrollKind | undefined,
  modifiers: ScrollRollModifiers,
) {
  if (!kind) return false;
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
  return false;
}

function rollForSide(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: ScrollRollModifiers,
) {
  const playerId = battlePlayerForSide(battle, side);
  const player = playerId ? state.players[playerId] : undefined;
  const sides = Math.max(
    2,
    (modifiers.sidesOverride ?? 6) + (player ? getDieSidesBonus(player, dieKind) : 0),
  );
  const count = Math.max(
    1,
    1 + modifiers.extraDice + (player ? getDiceCountBonus(player, dieKind) : 0),
  );
  const dice = Array.from({ length: count }, () =>
    Math.min(sides, Math.max(modifiers.minimumRoll, rollDie(state, sides))),
  );
  return {
    sides,
    dice,
    sum: dice.reduce((total, die) => total + die, 0),
  };
}

function resolveBattleRound(state: GameState) {
  if (state.phase.kind !== "battle") return;
  const battle = state.phase.battle;
  const attackerSide = battle.attacker;
  const defenderSideForChoice: CombatSide = attackerSide === "a" ? "b" : "a";
  const attackScrollId = chosenInstanceId(choiceFor(battle, attackerSide));
  const defenseScrollId = chosenInstanceId(choiceFor(battle, defenderSideForChoice));
  const defenderSide = attackerSide === "a" ? "b" : "a";
  const attackerId = battlePlayerForSide(battle, attackerSide);
  const defenderId = battlePlayerForSide(battle, defenderSide);
  const attackScrollKind = attackerId
    ? consumeScroll(state, state.players[attackerId], attackScrollId)
    : undefined;
  const attackModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    attackerSide,
    defenderSide,
    attackScrollKind,
    attackModifiers,
  )) {
    finishBattle(state, battle, attackerSide);
    return;
  }

  const defenseScrollKind = defenderId
    ? consumeScroll(state, state.players[defenderId], defenseScrollId)
    : undefined;
  const defenseModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    defenderSide,
    attackerSide,
    defenseScrollKind,
    defenseModifiers,
  )) {
    finishBattle(state, battle, defenderSide);
    return;
  }
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
  const attackBase = sideStats(state, battle, attackerSide).attack;
  const defenseBase = sideStats(state, battle, defenderSide).defense;
  const attackBonus = attackModifiers.flatBonus;
  const defenseBonus = defenseModifiers.flatBonus;
  const attackTotal = attackBase + attackRoll.sum + attackBonus;
  const defenseTotal = defenseBase + defenseRoll.sum + defenseBonus;
  const damage = Math.max(0, attackTotal - defenseTotal);

  emit(state, {
    type: "attackRolled",
    side: attackerSide,
    die: attackRoll.sum,
    dice: attackRoll.dice,
    sides: attackRoll.sides,
    base: attackBase,
    scrollBonus: attackBonus,
    total: attackTotal,
  });
  emit(state, {
    type: "defenseRolled",
    side: defenderSide,
    die: defenseRoll.sum,
    dice: defenseRoll.dice,
    sides: defenseRoll.sides,
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
    finishBattle(state, battle, attackerSide);
    return;
  }

  battle.attacker = defenderSide;
  battle.round += 1;
  resetChoices(battle);
  emit(state, {
    type: "battleRoundAdvanced",
    round: battle.round,
    attacker: defenderSide,
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
  instanceId?: string,
) {
  if (state.phase.kind !== "battle") return;
  const battle = state.phase.battle;
  if (choiceFor(battle, side).status !== "pending") return;

  const playerId = battlePlayerForSide(battle, side);
  if (!playerId) return;

  if (instanceId) {
    // 校验这张牌确实在手上，且此刻打得出（8.5 每方每回合最多一张）
    const timing: ScrollTiming =
      side === battle.attacker ? "beforeAttackRoll" : "beforeDefenseRoll";
    const owned = playableScrolls(state.players[playerId], timing)
      .some((scroll) => scroll.instanceId === instanceId);
    if (!owned) return;
    setChoice(battle, side, { status: "chosen", instanceId });
  } else {
    setChoice(battle, side, { status: "declined" });
  }

  if (battle.choiceA.status !== "pending" && battle.choiceB.status !== "pending") {
    resolveBattleRound(state);
  }
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
  if (state.phase.kind !== "equipmentChoice") return;
  const choice = state.phase.choice;
  const player = state.players[choice.playerId];
  const offered = choice.offered;
  const offeredDefinition = EQUIPMENT[offered.kind];

  if (!replaceInstanceId) {
    addHistory(state, `${player.name}放弃了${offeredDefinition.name}。`);
    resumeAfterEquipmentChoice(state, choice.resume);
    return;
  }

  const existing = player.equipment.find(
    (item) => item.instanceId === replaceInstanceId,
  );
  if (
    !existing ||
    equipmentCategory(existing.kind) !== equipmentCategory(offered.kind)
  ) {
    return;
  }

  const removed = removeEquipmentStats(state, player, existing.instanceId);
  if (!removed) return;
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
      return;
    }
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
      const sides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
      const roll = rollDie(next, sides);
      next.lastMovementRoll = roll;
      const positionBefore = player.position;
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
    case "submitScrollChoice":
      submitScrollChoice(next, action.side, action.instanceId);
      return next;
    case "choosePvpPenalty":
      choosePvpPenalty(next, action);
      return next;
    case "chooseEquipment":
      chooseEquipment(next, action.replaceInstanceId);
      return next;
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
  const b = battle.bPlayerId ? state.players[battle.bPlayerId] : ENEMIES[battle.enemyId!];
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
