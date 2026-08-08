import { equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import { getDieSidesBonus } from "./selectors";
import { finishBattle, startBattle } from "./battle";
import { submitScrollChoice } from "./battleRound";
import { blessingMovementRollBonus } from "./blessings";
import { MAP_REGION_SIZE, regionForPosition } from "./map";
import { consumeScroll } from "./resources";
import { addHistory, createInitialGame, emit, rollDie } from "./state";
import { restAtStageCamp, stageBossUnlocked } from "./stages";
import { buyShopItem } from "./economy";
import { cancelTrade, confirmTrade, submitTradeOffer } from "./trading";
import { acknowledgePveReward, chooseEquipment, chooseStatGrowth } from "./rewards";
import { chooseEncounterIntent, chooseEncounterOpponent } from "./encounters";
import {
  chooseBlessing,
  choosePvpPenalty,
  settleUnavailablePvpPenalty,
  settleWaivedPvpPenalty,
} from "./pvpPenalty";
import { resolveTile, settleTileDebt } from "./tiles";
import { advanceCompletedTurn, rebaseEventIds } from "./turns";
import type {
  ActionResult,
  GameAction,
  GameState,
  OwnedScroll,
  Player,
} from "./types";

/**
 * 动作分发，以及规则层的对外门面。
 *
 * 具体规则都在旁边的模块里：state 是地基，tiles 回答「踩到一格会发生什么」，
 * resources 管背包，battle 与 battleRound 管战斗，encounters / trading /
 * pvpPenalty / rewards 各管一段相遇之后的流程。这里只回答一个问题——
 * 一个 action 该派给谁，以及掉线时替谁兜底。
 */

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

/**
 * 把下游模块交回来的 ActionResult 折算成 reducer 的返回值。
 *
 * false 时退回旧状态，维持「非法动作不产生新状态」的约定；欠下的那次格子结算
 * 交给 tiles 兑现。相遇、交易、装备选择都走这条路。
 */
function settleActionResult(
  next: GameState,
  previous: GameState,
  result: ActionResult,
): GameState {
  if (result === false) return previous;
  settleTileDebt(next, result);
  return next;
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
