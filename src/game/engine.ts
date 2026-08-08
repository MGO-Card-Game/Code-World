import { equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import type { ScrollDefinition } from "./content/scrolls";
import type { ScrollEffectDefinition } from "./effects/cardEffects";
import { getDieSidesBonus } from "./selectors";
import { finishBattle, startBattle } from "./battle";
import { submitScrollChoice } from "./battleRound";
import { blessingMovementRollBonus } from "./blessings";
import { MAP_REGION_SIZE, regionForPosition } from "./map";
import { consumeScroll } from "./resources";
import { addHistory, createInitialGame, emit, rollDie } from "./state";
import { restAtStageCamp, stageBossUnlocked } from "./stages";
import { buyShopItem } from "./economy";
import { leaveCasino, spinCasino } from "./casino";
import { buyShopOffer, leaveShop } from "./shop";
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
  MapRegion,
  MapTile,
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

interface LoopAdvanceResult {
  region: MapRegion;
  interceptedAtGate: boolean;
  passedCamp: boolean;
  targetTile: MapTile;
}

/**
 * 沿区域环路逐格前进 roll 格：处理守关门计次拦截、营地回血判定与经过效果。
 * 掷骰移动和"灵活行动"这类卷轴共用同一条路径，保证两者手感完全一致。
 */
function advanceAlongLoop(state: GameState, player: Player, roll: number): LoopAdvanceResult {
  const region = regionForPosition(state.map, player.position);
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
  return { region, interceptedAtGate, passedCamp, targetTile: state.map.tiles[player.position] };
}

/**
 * 直接把玩家挪到 region 内的绝对格子 targetPosition，不经过任何中间格。
 * teleport 系效果（固定距离/任意门）共用：只结算落点本身，含落点正好是
 * 营地或守关门的情况；沿途什么都不触发。
 */
function landDirectlyAt(
  state: GameState,
  player: Player,
  region: MapRegion,
  targetPosition: number,
): { interceptedAtGate: boolean; targetTile: MapTile } {
  player.position = targetPosition;
  let interceptedAtGate = false;
  if (player.position === region.gateIndex) {
    player.stageProgress[region.id].laps += 1;
    interceptedAtGate = stageBossUnlocked(player, region);
  }
  if (player.position === region.entryIndex) restAtStageCamp(state, player, region);
  return { interceptedAtGate, targetTile: state.map.tiles[player.position] };
}

/** 移动结束后的收尾：拦在守关门前进首领挑战选择，否则正常结算落点格子。 */
function settleMovementDestination(
  state: GameState,
  player: Player,
  region: MapRegion,
  interceptedAtGate: boolean,
  targetTile: MapTile,
) {
  if (interceptedAtGate) {
    state.phase = {
      kind: "bossGateChoice",
      choice: {
        playerId: player.id,
        stageId: region.id,
        gateTileIndex: region.gateIndex,
        bossEnemyId: region.bossEnemyId,
      },
    };
  } else {
    resolveTile(state, targetTile);
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

/**
 * "灵活行动"、"短程传送符"和"触手可得"这类卷轴：本身就是一次移动动作，用来代替 rollMovement，
 * 所以只能在还没掷骰的 awaitingRoll 用——移动完再打没有骰可代替。
 *
 * chooseMovement 直接复用 advanceAlongLoop，和正常掷骰移动逐格前进、触发同样的
 * 营地回血与守关门计次；teleport 是直接跳变位置，途中什么都不触发，
 * 只有落点本身会照常结算（含落在守关门/营地上）。
 */
function useMovementScroll(
  state: GameState,
  player: Player,
  instanceId: string,
  scrollKind: OwnedScroll["kind"],
  definition: ScrollDefinition,
  effect: Extract<ScrollEffectDefinition, { type: "chooseMovement" | "teleport" }>,
  distance: number | undefined,
) {
  if (state.phase.kind !== "awaitingRoll") return false;
  const sides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
  const maxDistance = effect.type === "chooseMovement" ? sides : effect.maxDistance;
  if (
    distance === undefined ||
    !Number.isInteger(distance) ||
    distance < 1 ||
    distance > maxDistance
  ) {
    return false;
  }

  consumeScroll(state, player, instanceId);
  const positionBefore = player.position;
  state.movementOrigin = positionBefore;

  if (effect.type === "chooseMovement") {
    const roll = distance + blessingMovementRollBonus(player);
    state.lastMovementRoll = roll;
    const { region, interceptedAtGate, passedCamp, targetTile } = advanceAlongLoop(state, player, roll);
    emit(state, { type: "movementRolled", playerId: player.id, value: roll, sides });
    emit(state, { type: "playerMoved", playerId: player.id, from: positionBefore, to: player.position });
    addHistory(
      state,
      `${player.name}使用${definition.name}，指定移动 ${distance} 格，抵达「${targetTile.label}」${
        interceptedAtGate ? "，已满足首领挑战条件" : ""
      }。`,
    );
    if (passedCamp) restAtStageCamp(state, player, region);
    settleMovementDestination(state, player, region, interceptedAtGate, targetTile);
  } else {
    const region = regionForPosition(state.map, player.position);
    const local = player.position - region.startIndex;
    const target = region.startIndex + ((local + distance) % MAP_REGION_SIZE);
    const { interceptedAtGate, targetTile } = landDirectlyAt(state, player, region, target);
    emit(state, { type: "playerMoved", playerId: player.id, from: positionBefore, to: player.position });
    addHistory(
      state,
      `${player.name}使用${definition.name}，跃至「${targetTile.label}」${
        interceptedAtGate ? "，已满足首领挑战条件" : ""
      }。`,
    );
    settleMovementDestination(state, player, region, interceptedAtGate, targetTile);
  }

  applyEquipmentMapScrollUse(state, player, scrollKind);
  return true;
}

/**
 * "任意门"：不受距离限制的传送，只要落在玩家当前所在阶段的环路内即可。
 * 落点结算规则和 teleport 完全一致，唯一区别是目标由绝对格子编号给出，
 * 不是相对当前位置的偏移量。
 */
function useTeleportAnywhereScroll(
  state: GameState,
  player: Player,
  instanceId: string,
  scrollKind: OwnedScroll["kind"],
  definition: ScrollDefinition,
  targetPosition: number | undefined,
) {
  if (state.phase.kind !== "awaitingRoll") return false;
  const region = regionForPosition(state.map, player.position);
  if (
    targetPosition === undefined ||
    !Number.isInteger(targetPosition) ||
    targetPosition < region.startIndex ||
    targetPosition > region.endIndex
  ) {
    return false;
  }

  consumeScroll(state, player, instanceId);
  const positionBefore = player.position;
  state.movementOrigin = positionBefore;
  const { interceptedAtGate, targetTile } = landDirectlyAt(state, player, region, targetPosition);
  emit(state, { type: "playerMoved", playerId: player.id, from: positionBefore, to: player.position });
  addHistory(
    state,
    `${player.name}使用${definition.name}，传送至「${targetTile.label}」${
      interceptedAtGate ? "，已满足首领挑战条件" : ""
    }。`,
  );
  settleMovementDestination(state, player, region, interceptedAtGate, targetTile);

  applyEquipmentMapScrollUse(state, player, scrollKind);
  return true;
}

/** 地图阶段使用；返回 false 时保持“非法动作不产生新状态”的约定。 */
function useMapScroll(
  state: GameState,
  instanceId: string,
  distance?: number,
  targetPosition?: number,
) {
  if (state.phase.kind !== "awaitingRoll" && state.phase.kind !== "turnComplete") {
    return false;
  }
  const player = state.players[state.activePlayerId];
  const owned = player.scrolls.find((scroll) => scroll.instanceId === instanceId);
  if (!owned) return false;
  const definition = scrollDefinition(owned.kind);
  if (!definition.timings.includes("map")) return false;

  const movementEffect = definition.effects.find(
    (effect): effect is Extract<ScrollEffectDefinition, { type: "chooseMovement" | "teleport" }> =>
      effect.type === "chooseMovement" || effect.type === "teleport",
  );
  if (movementEffect) {
    return useMovementScroll(state, player, instanceId, owned.kind, definition, movementEffect, distance);
  }

  const teleportAnywhere = definition.effects.some((effect) => effect.type === "teleportAnywhere");
  if (teleportAnywhere) {
    return useTeleportAnywhereScroll(state, player, instanceId, owned.kind, definition, targetPosition);
  }

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
      {
        const source = next.phase.choice.source;
        chooseBlessing(next, false);
        if (
          source === "tile" &&
          (next.phase as GameState["phase"]).kind === "turnComplete" &&
          next.activePlayerId === playerId
        ) {
          advanceCompletedTurn(next);
        }
        return next;
      }
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
      const phaseAfterEquipmentFallback = next.phase as GameState["phase"];
      if (
        phaseAfterEquipmentFallback.kind === "shop" &&
        phaseAfterEquipmentFallback.shop.playerId === playerId
      ) {
        leaveShop(next);
      }
      if (
        phaseAfterEquipmentFallback.kind === "casino" &&
        phaseAfterEquipmentFallback.casino.playerId === playerId
      ) {
        leaveCasino(next);
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
    case "shop":
      if (next.phase.shop.playerId !== playerId) return state;
      leaveShop(next);
      if (next.activePlayerId === playerId) advanceCompletedTurn(next);
      return next;
    case "casino":
      if (next.phase.casino.playerId !== playerId) return state;
      leaveCasino(next);
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
      const { region, interceptedAtGate, passedCamp, targetTile } = advanceAlongLoop(next, player, roll);
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
      addHistory(
        next,
        interceptedAtGate
          ? `${player.name}掷出 ${roll}，抵达「${targetTile.label}」，已满足首领挑战条件。`
          : `${player.name}掷出 ${roll}，抵达「${targetTile.label}」。`,
      );
      // 回血要在结算格子之前：这一步路过营地、下一步踩进战斗格的人应当满血开打
      if (passedCamp) restAtStageCamp(next, player, region);
      settleMovementDestination(next, player, region, interceptedAtGate, targetTile);
      return next;
    }
    case "useMapScroll":
      return useMapScroll(next, action.instanceId, action.distance, action.targetPosition) ? next : state;
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
    case "buyShopOffer":
      return buyShopOffer(next, action.offerId) ? next : state;
    case "leaveShop":
      return leaveShop(next) ? next : state;
    case "spinCasino":
      return spinCasino(next) ? next : state;
    case "leaveCasino":
      return leaveCasino(next) ? next : state;
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
