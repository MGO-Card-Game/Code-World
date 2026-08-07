import { EQUIPMENT, equipmentCategory, equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import { getDieSidesBonus, pvpHpTransferAmount } from "./selectors";
import { finishBattle, PVP_RETREAT_TILES, startBattle } from "./battle";
import { submitScrollChoice } from "./battleRound";
import {
  blessingName,
  blessingMovementRollBonus,
  bonusTreasureEquipment,
  detachBlessing,
  grantRandomBlessing,
  receiveTransferredBlessing,
} from "./blessings";
import { resolveRandomMapEvent } from "./mapEvents";
import {
  applyEquipmentStats,
  consumeScroll,
  grantEquipment,
  grantRandomResourceReward,
  hasFreeEquipmentSlot,
  removeEquipmentStats,
  rewardSecret,
} from "./resources";
import { addHistory, createInitialGame, emit, nextPlayerId, rollDie } from "./state";
import type { GameAction, GameState, MapTile, OwnedScroll, Player } from "./types";

/**
 * 回合与格子流程、动作分发，以及规则层的对外门面。
 *
 * 具体规则都在旁边的模块里：state 是地基，resources 管背包，mapEvents 管事件格，
 * battle 与 battleRound 管战斗。这里只回答两个问题——踩到一格会发生什么，
 * 以及一个 action 该派给谁。
 */

function resolveTile(state: GameState, tile: MapTile, checkEncounter = true) {
  const player = state.players[state.activePlayerId];
  const opponents = Object.values(state.players).filter(
    (candidate) =>
      candidate.id !== player.id &&
      candidate.position === player.position &&
      !state.unavailablePlayerIds.includes(candidate.id),
  );

  if (checkEncounter && !tile.safeZone && opponents.length > 0) {
    if (opponents.length === 1) {
      startBattle(state, "pvp", player.id, undefined, opponents[0].id);
    } else {
      state.phase = {
        kind: "encounterChoice",
        choice: {
          challengerId: player.id,
          opponentIds: opponents.map((opponent) => opponent.id),
          tileIndex: tile.id,
        },
      };
      addHistory(state, `${player.name}遇到多名旅者，需要选择一名对手。`);
    }
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
      const bonusEquipment = bonusTreasureEquipment(player);
      const reward = grantRandomResourceReward(
        state,
        player,
        bonusEquipment > 0
          ? { kind: "grantTreasureEquipment", remaining: bonusEquipment }
          : undefined,
      );
      const line = (what: string) => `${player.name}打开宝箱，获得${what}。`;
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      if (!reward.pendingEquipmentChoice) {
        if (bonusEquipment > 0) grantTreasureEquipmentReward(state, player, bonusEquipment);
        else state.phase = { kind: "turnComplete" };
      }
      return;
    }
    case "blessing": {
      if (player.blessings.length > 0) {
        state.phase = { kind: "turnComplete" };
        addHistory(state, `${player.name}已经拥有赐福，没有从「${tile.label}」重复获得。`);
        return;
      }
      const blessing = grantRandomBlessing(state, player);
      state.phase = { kind: "turnComplete" };
      addHistory(
        state,
        blessing
          ? `${player.name}在「${tile.label}」获得永久赐福：${blessingName(blessing)}。`
          : `${player.name}来到「${tile.label}」，但赐福内容尚未配置。`,
      );
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

/**
 * 地图上打完一张牌之后的装备钩子，对标战斗里的 applyEquipmentScrollUse。
 *
 * 地图上没有"倒下"这个状态，所以扣血至少保留 1 点——山路落石那类地图伤害
 * 用的是同一个约定（见 hazards.ts 的 minimumHp）。真要让代价致命，得先给
 * 地图阶段定一套战败规则，那是另一件事。
 */
function applyEquipmentMapScrollUse(
  state: GameState,
  player: Player,
  scroll: OwnedScroll["kind"],
) {
  // 复制一份：钩子理论上可以改动装备列表，遍历时被改会漏掉后面的装备
  for (const item of [...player.equipment]) {
    equipmentDefinition(item.kind).effects?.onScrollUsed?.({
      state,
      player,
      item,
      scroll,
      loseHp(amount, logLine) {
        const hpBefore = player.hp;
        player.hp = Math.max(1, player.hp - Math.max(0, amount));
        if (player.hp === hpBefore) return;
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "equipment",
        });
        addHistory(state, logLine);
      },
    });
  }
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
  // 代价排在效果之后，和战斗里那条路径对齐（battleRound 的 applyEquipmentScrollUse）：
  // 反过来的话，残血时打疗牌会因为扣血下限白嫖掉代价
  applyEquipmentMapScrollUse(state, player, owned.kind);
  return true;
}

/** 选择同格相遇战目标；候选名单由移动结算时锁定，不能由客户端自行指定。 */
function chooseEncounterOpponent(state: GameState, opponentId: Player["id"]) {
  if (state.phase.kind !== "encounterChoice") return false;
  const { challengerId, opponentIds, tileIndex } = state.phase.choice;
  if (!opponentIds.includes(opponentId) || opponentId === challengerId) return false;

  const challenger = state.players[challengerId];
  const opponent = state.players[opponentId];
  if (
    !challenger ||
    !opponent ||
    state.unavailablePlayerIds.includes(opponentId) ||
    challenger.position !== tileIndex ||
    opponent.position !== tileIndex ||
    state.map.tiles[tileIndex]?.safeZone
  ) {
    return false;
  }

  startBattle(state, "pvp", challengerId, undefined, opponentId);
  return true;
}

function finishPenaltyAndResolveTile(state: GameState, tileIndex: number) {
  resolveTile(state, state.map.tiles[tileIndex], false);
}

function settleWaivedPvpPenalty(state: GameState) {
  if (state.phase.kind !== "pvpPenalty" || !state.phase.penalty.waived) return false;
  const { loserId, tileIndex } = state.phase.penalty;
  if (
    state.unavailablePlayerIds.includes(loserId) &&
    state.activePlayerId === loserId
  ) {
    state.phase = { kind: "turnComplete" };
    advanceCompletedTurn(state);
    return true;
  }
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
}

function grantTreasureEquipmentReward(
  state: GameState,
  player: Player,
  remaining: number,
) {
  if (remaining <= 0) {
    state.phase = { kind: "turnComplete" };
    return;
  }
  const reward = grantEquipment(
    state,
    player,
    undefined,
    remaining > 1
      ? { kind: "grantTreasureEquipment", remaining: remaining - 1 }
      : { kind: "turnComplete" },
  );
  if (!reward.pendingEquipmentChoice) {
    if (remaining > 1) grantTreasureEquipmentReward(state, player, remaining - 1);
    else state.phase = { kind: "turnComplete" };
  }
  addHistory(state, `${player.name}因宝物猎人额外获得${reward.name}。`);
}

function resumeAfterEquipmentChoice(
  state: GameState,
  playerId: Player["id"],
  resume: Extract<GameState["phase"], { kind: "equipmentChoice" }>["choice"]["resume"],
) {
  switch (resume.kind) {
    case "turnComplete":
      state.phase = { kind: "turnComplete" };
      return;
    case "resolveTile":
      resolveTile(state, state.map.tiles[resume.tileIndex], false);
      return;
    case "grantTreasureEquipment": {
      grantTreasureEquipmentReward(state, state.players[playerId], resume.remaining);
      return;
    }
  }
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
    resumeAfterEquipmentChoice(state, choice.playerId, choice.resume);
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
  resumeAfterEquipmentChoice(state, choice.playerId, choice.resume);
  return true;
}

/** 赢家在已有赐福时，选择保留原赐福或用败方赐福覆盖。 */
function chooseBlessing(state: GameState, replace: boolean) {
  if (state.phase.kind !== "blessingChoice") return false;
  const { winnerId, loserId, offered, tileIndex, penaltyWaived } = state.phase.choice;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];
  const existing = winner.blessings[0];

  if (replace) {
    const existingName = existing ? blessingName(existing) : undefined;
    if (existing) detachBlessing(state, winner);
    if (!receiveTransferredBlessing(state, winner, loserId, offered)) return false;
    addHistory(
      state,
      existingName
        ? `${winner.name}放弃${existingName}，接纳了${loser.name}的${blessingName(offered)}。`
        : `${winner.name}接纳了${loser.name}的${blessingName(offered)}。`,
    );
  } else {
    addHistory(
      state,
      `${winner.name}保留自己的赐福，${loser.name}失去的${blessingName(offered)}随之消散。`,
    );
  }

  state.phase = {
    kind: "pvpPenalty",
    penalty: { winnerId, loserId, tileIndex, waived: penaltyWaived },
  };
  if (penaltyWaived) {
    settleWaivedPvpPenalty(state);
    return true;
  }
  // 败方可能早已掉线超时；赢家作出选择后不能再等待一个已经不会触发的计时器。
  if (state.unavailablePlayerIds.includes(loserId)) {
    choosePvpPenalty(state, { type: "choosePvpPenalty", choice: "retreat" });
    if (
      (state.phase as GameState["phase"]).kind === "turnComplete" &&
      state.activePlayerId === loserId
    ) {
      advanceCompletedTurn(state);
    }
  }
  return true;
}

function choosePvpPenalty(
  state: GameState,
  action: Extract<GameAction, { type: "choosePvpPenalty" }>,
) {
  if (state.phase.kind !== "pvpPenalty" || state.phase.penalty.waived) return false;
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

function advanceCompletedTurn(state: GameState) {
  state.activePlayerId = nextPlayerId(state);
  state.turn += 1;
  state.lastMovementRoll = undefined;
  state.movementOrigin = undefined;
  const incoming = state.players[state.activePlayerId];
  if (incoming.skipNextMovement) {
    delete incoming.skipNextMovement;
    state.phase = { kind: "turnComplete" };
  } else {
    state.phase = { kind: "awaitingRoll" };
  }
  emit(state, {
    type: "turnStarted",
    playerId: state.activePlayerId,
    turn: state.turn,
  });
  addHistory(
    state,
    state.phase.kind === "turnComplete"
      ? `${incoming.name}受战地药剂影响，本回合无法移动。`
      : `轮到${incoming.name}行动。`,
  );
}

/**
 * 联机玩家掉线超过宽限期后的保底结算。只处理此刻必须由该玩家响应的阶段，
 * 防止三、四人局被一个永久离线席位锁死；短暂掉线由服务器宽限期吸收。
 */
export function handleDisconnectTimeout(state: GameState, playerId: Player["id"]): GameState {
  if (
    !state.unavailablePlayerIds.includes(playerId) ||
    !state.players[playerId]
  ) {
    return state;
  }

  const next = structuredClone(state);
  next.lastEvents = [];
  const timedOut = next.players[playerId];

  switch (next.phase.kind) {
    case "awaitingRoll":
      if (next.activePlayerId !== playerId) return state;
      next.phase = { kind: "turnComplete" };
      addHistory(next, `${timedOut.name}掉线超时，本回合跳过。`);
      advanceCompletedTurn(next);
      return next;
    case "turnComplete":
      if (next.activePlayerId !== playerId) return state;
      addHistory(next, `${timedOut.name}掉线超时，自动结束回合。`);
      advanceCompletedTurn(next);
      return next;
    case "encounterChoice":
      if (next.phase.choice.challengerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，放弃本次相遇战与格子结算。`);
        advanceCompletedTurn(next);
        return next;
      }
      if (!next.phase.choice.opponentIds.includes(playerId)) return state;
      next.phase.choice.opponentIds = next.phase.choice.opponentIds.filter(
        (id) => !next.unavailablePlayerIds.includes(id),
      );
      if (next.phase.choice.opponentIds.length === 0) {
        const tileIndex = next.phase.choice.tileIndex;
        addHistory(next, "同格对手均已掉线，跳过相遇战。");
        resolveTile(next, next.map.tiles[tileIndex], false);
      }
      return next;
    case "battle": {
      const battle = next.phase.battle;
      const loserSide = battle.aPlayerId === playerId
        ? "a"
        : battle.bPlayerId === playerId
          ? "b"
          : undefined;
      if (!loserSide) return state;
      finishBattle(next, battle, loserSide === "a" ? "b" : "a");
      const phaseAfterBattle = next.phase as GameState["phase"];
      if (phaseAfterBattle.kind === "pvpPenalty") {
        if (phaseAfterBattle.penalty.waived) {
          settleWaivedPvpPenalty(next);
        } else if (phaseAfterBattle.penalty.loserId === playerId) {
          choosePvpPenalty(next, { type: "choosePvpPenalty", choice: "retreat" });
        }
      }
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    }
    case "blessingChoice":
      if (next.phase.choice.winnerId !== playerId) return state;
      chooseBlessing(next, false);
      return next;
    case "pvpPenalty":
      if (next.phase.penalty.loserId !== playerId) return state;
      choosePvpPenalty(next, { type: "choosePvpPenalty", choice: "retreat" });
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "equipmentChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      chooseEquipment(next);
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "gameOver":
      return state;
  }
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
    const playerIds = Object.keys(state.players) as Player["id"][];
    const playerNames = Object.fromEntries(
      playerIds.map((id) => [id, state.players[id].name]),
    );
    return rebaseEventIds(
      createInitialGame(action.seed, playerNames, playerIds),
      state.nextEventId,
    );
  }
  const next = structuredClone(state);
  next.lastEvents = [];

  switch (action.type) {
    case "rollMovement": {
      if (next.phase.kind !== "awaitingRoll") return state;
      const player = next.players[next.activePlayerId];
      const sides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
      const roll = rollDie(next, sides) + blessingMovementRollBonus(player);
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
      advanceCompletedTurn(next);
      return next;
    }
    case "chooseEncounterOpponent":
      return chooseEncounterOpponent(next, action.opponentId) ? next : state;
    case "chooseBlessing":
      return chooseBlessing(next, action.replace) ? next : state;
    case "submitScrollChoice":
      if (!submitScrollChoice(next, action.side, action.instanceIds)) return state;
      settleWaivedPvpPenalty(next);
      return next;
    case "choosePvpPenalty":
      return choosePvpPenalty(next, action) ? next : state;
    case "chooseEquipment":
      return chooseEquipment(next, action.replaceInstanceId) ? next : state;
  }
}

/*
  规则层的对外门面。

  界面、联机服务器和测试一律从这里 import，内部怎么拆模块都不影响它们；
  engine.ts 自己则只留回合与格子流程、动作分发这两件事。
*/
export {
  getBattleParticipants,
  getSidePlayer,
  PVP_RETREAT_TILES,
} from "./battle";
export { createInitialGame, PLAYER_IDS } from "./state";
