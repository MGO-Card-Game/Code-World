import { EQUIPMENT, equipmentCategory, equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import { getDieSidesBonus, pvpHpTransferAmount } from "./selectors";
import { finishBattle, startBattle } from "./battle";
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
import { MAP_REGION_SIZE, regionForPosition } from "./map";
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
import { applyStatGrowth, STAT_GROWTH } from "./growth";
import { restAtStageCamp, stageBossUnlocked } from "./stages";
import {
  buyShopItem,
  ECONOMY,
  grantGold,
  pvpGoldTransferAmount,
  salvageEquipment,
  transferPvpGold,
} from "./economy";
import { cancelTrade, confirmTrade, submitTradeOffer } from "./trading";
import {
  acknowledgePveReward,
  chooseEquipment,
  chooseStatGrowth,
  grantTreasureEquipmentReward,
} from "./rewards";
import {
  chooseEncounterIntent,
  chooseEncounterOpponent,
  startEncounterDecision,
} from "./encounters";
import type {
  ActionResult,
  GameAction,
  GameState,
  MapTile,
  OwnedScroll,
  Player,
  StatGrowthOption,
} from "./types";

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
      startEncounterDecision(state, player.id, opponents[0].id, tile.id);
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
      startBattle(
        state,
        "pve",
        player.id,
        tile.enemyId,
        undefined,
        tile.eliteAffix,
        { stageId: tile.region, tileIndex: tile.id, retreatTo: player.checkpointTileId },
      );
      return;
    case "boss":
      startBattle(state, "boss", player.id, tile.enemyId);
      return;
    case "spring": {
      const hpBefore = player.hp;
      const healed = Math.min(5, player.maxHp - player.hp);
      player.hp += healed;
      player.checkpointTileId = tile.id;
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
      const progress = player.stageProgress[tile.region];
      if (progress.openedTreasureTileIds.includes(tile.id)) {
        state.phase = { kind: "turnComplete" };
        addHistory(state, `${player.name}检查「${tile.label}」，这里已经被搜空了。`);
        return;
      }
      progress.openedTreasureTileIds.push(tile.id);
      const gold = grantGold(state, player, ECONOMY.treasureGold, "treasure");
      const bonusEquipment = bonusTreasureEquipment(player);
      const reward = grantRandomResourceReward(
        state,
        player,
        bonusEquipment > 0
          ? { kind: "grantTreasureEquipment", remaining: bonusEquipment }
          : undefined,
      );
      const line = (what: string) => `${player.name}打开宝箱，获得${what}和 ${gold} 金币。`;
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
    case "gate":
      state.phase = { kind: "turnComplete" };
      addHistory(state, `${player.name}来到「${tile.label}」。`);
  }
}

function chooseBossChallenge(state: GameState, challenge: boolean) {
  if (state.phase.kind !== "bossGateChoice") return false;
  const { playerId, stageId, gateTileIndex, bossEnemyId } = state.phase.choice;
  const player = state.players[playerId];
  const region = state.map.regions.find((candidate) => candidate.id === stageId);
  if (!player || !region || player.position !== gateTileIndex) return false;
  if (!challenge) {
    state.phase = { kind: "turnComplete" };
    addHistory(state, `${player.name}暂不挑战${region.name}首领，继续整备。`);
    return true;
  }
  if (!stageBossUnlocked(player, region)) return false;
  startBattle(
    state,
    "boss",
    player.id,
    bossEnemyId,
    undefined,
    undefined,
    { stageId, tileIndex: gateTileIndex, retreatTo: player.checkpointTileId },
  );
  return true;
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

function finishPenaltyAndResolveTile(state: GameState, tileIndex: number) {
  resolveTile(state, state.map.tiles[tileIndex], false);
}

/**
 * 解释拆出去的模块交回来的 ActionResult。
 *
 * 格子结算只有这里做得了，所以「还欠一次结算」这件事由各模块作为数据交回，
 * 在这一处统一兑现——相遇、交易、相遇战代价都走这条路。
 */
function settleActionResult(
  next: GameState,
  previous: GameState,
  result: ActionResult,
): GameState {
  if (result === false) return previous;
  if (result !== true) resolveTile(next, next.map.tiles[result.resolveTile], false);
  return next;
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

/** 赢家在已有赐福时，选择保留原赐福或用败方赐福覆盖。 */
function chooseBlessing(state: GameState, replace: boolean) {
  if (state.phase.kind !== "blessingChoice") return false;
  const {
    winnerId,
    loserId,
    offered,
    tileIndex,
    penaltyWaived,
    penaltyWaiveReason,
  } = state.phase.choice;
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
    penalty: {
      winnerId,
      loserId,
      tileIndex,
      waived: penaltyWaived,
      waiveReason: penaltyWaiveReason,
    },
  };
  if (penaltyWaived) {
    settleWaivedPvpPenalty(state);
    return true;
  }
  // 败方可能早已掉线超时；赢家作出选择后不能再等待一个已经不会触发的计时器。
  if (state.unavailablePlayerIds.includes(loserId)) {
    settleUnavailablePvpPenalty(state);
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

  if (action.choice === "gold") {
    const amount = transferPvpGold(state, loser, winner);
    if (amount <= 0) return false;
    addHistory(state, `${loser.name}支付 ${amount} 金币给${winner.name}。`);
    finishPenaltyAndResolveTile(state, tileIndex);
    return true;
  }

  if (action.choice === "hp") {
    const amount = pvpHpTransferAmount(winner, loser);
    // 付不出就忽略这次提交，阶段留在原地让他重选。
    // 界面本来就不会画出这个按钮（同一个函数算的），走到这里说明是客户端越权，
    // 仍有资源项可选；两项都付不起的状态会在战斗结束时直接跳过本阶段。
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

/** 掉线玩家无法选择时按固定顺序自动支付；确实付不起则直接继续。 */
function settleUnavailablePvpPenalty(state: GameState) {
  if (state.phase.kind !== "pvpPenalty") return false;
  const { winnerId, loserId, tileIndex } = state.phase.penalty;
  const winner = state.players[winnerId];
  const loser = state.players[loserId];
  if (state.phase.penalty.waived) return settleWaivedPvpPenalty(state);
  if (pvpGoldTransferAmount(loser) > 0) {
    return choosePvpPenalty(state, { type: "choosePvpPenalty", choice: "gold" });
  }
  if (pvpHpTransferAmount(winner, loser) > 0) {
    return choosePvpPenalty(state, { type: "choosePvpPenalty", choice: "hp" });
  }
  const scroll = loser.scrolls[0];
  if (scroll) {
    return choosePvpPenalty(state, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "scroll",
      instanceId: scroll.instanceId,
    });
  }
  const equipment = loser.equipment[0];
  if (equipment) {
    return choosePvpPenalty(state, {
      type: "choosePvpPenalty",
      choice: "resource",
      resourceType: "equipment",
      instanceId: equipment.instanceId,
    });
  }
  finishPenaltyAndResolveTile(state, tileIndex);
  return true;
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
    case "encounterDecision": {
      const encounter = next.phase.encounter;
      if (encounter.aPlayerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，放弃本次相遇与格子结算。`);
        advanceCompletedTurn(next);
        return next;
      }
      if (encounter.bPlayerId !== playerId) return state;
      encounter.choiceB = { status: "pending" };
      return settleActionResult(
        next,
        state,
        chooseEncounterIntent(next, { type: "chooseEncounterIntent", side: "b", intent: "greet" }),
      );
    }
    case "tradeOffer":
    case "tradeConfirmation": {
      const trade = next.phase.trade;
      if (trade.aPlayerId !== playerId && trade.bPlayerId !== playerId) return state;
      if (trade.aPlayerId === playerId) {
        next.phase = { kind: "turnComplete" };
        addHistory(next, `${timedOut.name}掉线超时，交易取消并跳过格子结算。`);
        advanceCompletedTurn(next);
      } else {
        addHistory(next, `${timedOut.name}掉线超时，交易取消，双方相安无事。`);
        resolveTile(next, next.map.tiles[trade.tileIndex], false);
      }
      return next;
    }
    case "bossGateChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      chooseBossChallenge(next, false);
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
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
          settleUnavailablePvpPenalty(next);
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
      settleUnavailablePvpPenalty(next);
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "equipmentChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      settleActionResult(next, state, chooseEquipment(next));
      {
        const phaseAfterChoice = next.phase as GameState["phase"];
        if (
          phaseAfterChoice.kind === "pveReward" &&
          phaseAfterChoice.notice.playerId === playerId
        ) {
          acknowledgePveReward(next);
          if ((next.phase as GameState["phase"]).kind === "statGrowthChoice") {
            chooseStatGrowth(next, "maxHp");
          }
        }
      }
      if ((next.phase as GameState["phase"]).kind === "turnComplete" && next.activePlayerId === playerId) {
        advanceCompletedTurn(next);
      }
      return next;
    case "pveReward":
      if (next.phase.notice.playerId !== playerId) return state;
      acknowledgePveReward(next);
      if ((next.phase as GameState["phase"]).kind === "statGrowthChoice") {
        chooseStatGrowth(next, "maxHp");
      }
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "statGrowthChoice":
      if (next.phase.choice.playerId !== playerId) return state;
      // 掉线的人替他点生命上限：三档里只有它不改变这名玩家的战斗风格
      chooseStatGrowth(next, "maxHp");
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
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
      const region = regionForPosition(next.map, player.position);
      let interceptedAtGate = false;
      let passedCamp = false;
      for (let step = 0; step < roll; step += 1) {
        const local = player.position - region.startIndex;
        const nextLocal = (local + 1) % MAP_REGION_SIZE;
        player.position = region.startIndex + nextLocal;
        if (player.position === region.entryIndex) passedCamp = true;
        if (player.position !== region.gateIndex) continue;
        player.stageProgress[region.id].laps += 1;
        if (stageBossUnlocked(player, region)) {
          interceptedAtGate = true;
          break;
        }
      }
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
      addHistory(
        next,
        interceptedAtGate
          ? `${player.name}掷出 ${roll}，抵达「${targetTile.label}」，已满足首领挑战条件。`
          : `${player.name}掷出 ${roll}，抵达「${targetTile.label}」。`,
      );
      // 回血要在结算格子之前：这一步路过营地、下一步踩进战斗格的人应当满血开打
      if (passedCamp) restAtStageCamp(next, player, region);
      if (interceptedAtGate) {
        next.phase = {
          kind: "bossGateChoice",
          choice: {
            playerId: player.id,
            stageId: region.id,
            gateTileIndex: region.gateIndex,
            bossEnemyId: region.bossEnemyId,
          },
        };
      } else {
        resolveTile(next, targetTile);
      }
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
    case "chooseEncounterIntent":
      return settleActionResult(next, state, chooseEncounterIntent(next, action));
    case "submitTradeOffer":
      return settleActionResult(next, state, submitTradeOffer(next, action));
    case "cancelTrade":
      return settleActionResult(next, state, cancelTrade(next, action));
    case "confirmTrade":
      return settleActionResult(next, state, confirmTrade(next, action));
    case "chooseBossChallenge":
      return chooseBossChallenge(next, action.challenge) ? next : state;
    case "chooseBlessing":
      return chooseBlessing(next, action.replace) ? next : state;
    case "acknowledgePveReward":
      return acknowledgePveReward(next) ? next : state;
    case "buyShopItem":
      return buyShopItem(next, action.item) ? next : state;
    case "submitScrollChoice":
      if (!submitScrollChoice(next, action.side, action.instanceIds)) return state;
      settleWaivedPvpPenalty(next);
      return next;
    case "choosePvpPenalty":
      return choosePvpPenalty(next, action) ? next : state;
    case "chooseEquipment":
      return settleActionResult(next, state, chooseEquipment(next, action.replaceInstanceId));
    case "chooseStatGrowth":
      return chooseStatGrowth(next, action.option) ? next : state;
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
} from "./battle";
export { createInitialGame, PLAYER_IDS } from "./state";
