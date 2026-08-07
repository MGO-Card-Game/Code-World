import { EQUIPMENT, equipmentCategory, equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import { getDieSidesBonus, pvpHpTransferAmount } from "./selectors";
import { PVP_RETREAT_TILES, startBattle } from "./battle";
import { submitScrollChoice } from "./battleRound";
import { resolveRandomMapEvent } from "./mapEvents";
import {
  applyEquipmentStats,
  consumeScroll,
  grantRandomResourceReward,
  hasFreeEquipmentSlot,
  removeEquipmentStats,
  rewardSecret,
} from "./resources";
import { addHistory, createInitialGame, emit, otherPlayer, rollDie } from "./state";
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
