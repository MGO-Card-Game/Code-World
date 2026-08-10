import { startBattle } from "./battle";
import { blessingMovementRollBonus } from "./blessings";
import { equipmentDefinition } from "./content/equipment";
import { scrollDefinition } from "./content/scrolls";
import type { ScrollDefinition } from "./content/scrolls";
import type { ScrollEffectDefinition, TargetedScrollEffect } from "./effects/cardEffects";
import { bossKeyPrice, spendGold, transferGold } from "./economy";
import { MAP_REGION_SIZE, regionForPosition } from "./map";
import { advanceAlongLoop, landDirectlyAt } from "./movement";
import { consumeScroll } from "./resources";
import { getDieSidesBonus } from "./selectors";
import { addHistory, emit, rollDie } from "./state";
import { restAtStageCamp, stageBossUnlocked } from "./stages";
import { resolveTile } from "./tiles";
import type {
  GameState,
  MapRegion,
  MapTile,
  OwnedScroll,
  Player,
} from "./types";

/**
 * 地图阶段动作：移动、地图卷轴、守关门与首领选择。
 *
 * 这里处理会改变玩家地图位置或触发落点结算的 action；engine.ts 只负责分发。
 */

export function rollMovement(state: GameState) {
  if (state.phase.kind !== "awaitingRoll") return false;
  const player = state.players[state.activePlayerId];
  const sides = Math.max(2, 6 + getDieSidesBonus(player, "movement"));
  /*
    被绊倒时点数直接钉死，赐福的移动加成也不叠上去——"下次掷骰点数为 1"
    说的是最终点数。这一支不消耗随机数，同种子重放照样对得上：
    消耗量只取决于状态，而状态本身是复现的。
  */
  const forced = player.forcedMovementRoll;
  delete player.forcedMovementRoll;
  const roll = forced ?? rollDie(state, sides) + blessingMovementRollBonus(player);
  state.lastMovementRoll = roll;
  const positionBefore = player.position;
  state.movementOrigin = positionBefore;
  const { region, interceptedAtGate, passedCamp, targetTile } =
    advanceAlongLoop(state, player, roll);
  emit(state, {
    type: "movementRolled",
    playerId: player.id,
    value: roll,
    sides,
  });
  emit(state, {
    type: "playerMoved",
    playerId: player.id,
    from: positionBefore,
    to: player.position,
  });
  addHistory(
    state,
    interceptedAtGate
      ? `${player.name}掷出 ${roll}，抵达「${targetTile.label}」，已满足首领挑战条件。`
      : `${player.name}掷出 ${roll}，抵达「${targetTile.label}」。`,
  );
  // 回血要在结算格子之前：这一步路过营地、下一步踩进战斗格的人应当满血开打
  if (passedCamp) restAtStageCamp(state, player, region);
  settleMovementDestination(state, player, region, interceptedAtGate, targetTile);
  return true;
}

export function chooseBossChallenge(state: GameState, challenge: boolean) {
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
  if (!player.stageProgress[stageId].bossKeyPurchased) return false;
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

export function buyBossKey(state: GameState) {
  if (state.phase.kind !== "bossGateChoice") return false;
  const { playerId, stageId, gateTileIndex } = state.phase.choice;
  const player = state.players[playerId];
  const region = state.map.regions.find((candidate) => candidate.id === stageId);
  if (!player || !region || player.position !== gateTileIndex) return false;
  if (!stageBossUnlocked(player, region)) return false;
  const progress = player.stageProgress[stageId];
  if (progress.bossKeyPurchased) return false;
  const price = bossKeyPrice(state.map, stageId);
  if (price <= 0 || !spendGold(state, player, price, "bossKey")) return false;
  progress.bossKeyPurchased = true;
  addHistory(state, `${player.name}花费 ${price} 金币购买了${region.name}的首领钥匙。`);
  return true;
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

/**
 * 「不掷骰，直接前进 N 格」——和掷骰移动逐格走同一条路，落点照常结算。
 */
function useAdvanceScroll(
  state: GameState,
  player: Player,
  instanceId: string,
  scrollKind: OwnedScroll["kind"],
  definition: ScrollDefinition,
  distance: number,
) {
  if (state.phase.kind !== "awaitingRoll") return false;
  consumeScroll(state, player, instanceId);
  const positionBefore = player.position;
  state.movementOrigin = positionBefore;
  state.lastMovementRoll = distance;
  const { region, interceptedAtGate, passedCamp, targetTile } =
    advanceAlongLoop(state, player, distance);
  emit(state, { type: "playerMoved", playerId: player.id, from: positionBefore, to: player.position });
  addHistory(
    state,
    `${player.name}使用${definition.name}，前进 ${distance} 格抵达「${targetTile.label}」${
      interceptedAtGate ? "，已满足首领挑战条件" : ""
    }。`,
  );
  if (passedCamp) restAtStageCamp(state, player, region);
  settleMovementDestination(state, player, region, interceptedAtGate, targetTile);
  applyEquipmentMapScrollUse(state, player, scrollKind);
  return true;
}

/**
 * 某条针对型效果此刻能选谁。
 *
 * 名单由引擎锁定后写进阶段，客户端不能自行指定——这和相遇战选对手是同一条约定。
 */
function targetCandidates(state: GameState, player: Player, apply: TargetedScrollEffect) {
  const others = state.turnOrder.filter((id) => id !== player.id);
  if (apply.type !== "swapPositions") return others;
  /*
    换位只能在同一区域内。跨区域换位是这批牌里最大的规则漏洞：山脚的玩家和
    山顶的玩家换一次，就绕开了两道守关门和两场阶段首领白拿进度。
  */
  const regionId = regionForPosition(state.map, player.position).id;
  return others.filter(
    (id) => regionForPosition(state.map, state.players[id].position).id === regionId,
  );
}

/** 换位牌代替本次移动，所以和其他移动牌一样只能在还没掷骰时打出。 */
function replacesMovement(apply: TargetedScrollEffect) {
  return apply.type === "swapPositions";
}

/**
 * 打出一张要选人的牌：先把牌消耗掉，再停在选人阶段。
 *
 * 先消耗是刻意的，和战斗里 consumeScrolls 同一条约定——打出去的牌不退回，
 * 中途掉线也不会把牌变回手上。
 */
function useTargetedScroll(
  state: GameState,
  player: Player,
  instanceId: string,
  scrollKind: OwnedScroll["kind"],
  definition: ScrollDefinition,
  effect: Extract<ScrollEffectDefinition, { type: "targetPlayer" }>,
  effectIndex: number,
) {
  const resume = state.phase.kind === "awaitingRoll" ? "awaitingRoll" : "turnComplete";
  if (replacesMovement(effect.apply) && resume !== "awaitingRoll") return false;
  const candidateIds = targetCandidates(state, player, effect.apply);
  if (candidateIds.length === 0) return false;

  consumeScroll(state, player, instanceId);
  state.phase = {
    kind: "scrollTargetChoice",
    choice: { playerId: player.id, candidateIds, scrollKind, effectIndex, resume },
  };
  addHistory(state, `${player.name}打出${definition.name}，正在选择目标。`);
  applyEquipmentMapScrollUse(state, player, scrollKind);
  return true;
}

/** 施加选定目标之后的效果。只能经 useTargetedScroll 抵达。 */
function applyTargetedScrollEffect(
  state: GameState,
  player: Player,
  target: Player,
  apply: TargetedScrollEffect,
  scrollName: string,
) {
  switch (apply.type) {
    case "stealGold": {
      const amount = transferGold(state, target, player, apply.amount, "event");
      addHistory(
        state,
        amount > 0
          ? `${player.name}用${scrollName}从${target.name}身上勒索到 ${amount} 金币。`
          : `${target.name}掏不出一枚金币，${scrollName}落了空。`,
      );
      return;
    }
    case "forceMovementRoll": {
      target.forcedMovementRoll = apply.value;
      addHistory(
        state,
        `${target.name}被${player.name}的${scrollName}缠住，下一次掷骰移动只能走 ${apply.value} 格。`,
      );
      return;
    }
    case "pushBack": {
      const region = regionForPosition(state.map, target.position);
      const local = target.position - region.startIndex;
      const back = ((local - apply.distance) % MAP_REGION_SIZE + MAP_REGION_SIZE)
        % MAP_REGION_SIZE;
      const from = target.position;
      target.position = region.startIndex + back;
      emit(state, { type: "playerMoved", playerId: target.id, from, to: target.position });
      addHistory(
        state,
        `${target.name}跟着${player.name}的${scrollName}倒退了 ${apply.distance} 格，`
          + `退回「${state.map.tiles[target.position].label}」。`,
      );
      return;
    }
    case "swapPositions": {
      const playerFrom = player.position;
      const targetFrom = target.position;
      state.movementOrigin = playerFrom;
      player.position = targetFrom;
      target.position = playerFrom;
      /*
        两边都发 playerMoved，界面才会同时画出两枚棋子的移动。
        圈数一概不动：换位不是走过去的，跨守关门算圈会让互相换位刷出挑战资格。
      */
      emit(state, { type: "playerMoved", playerId: player.id, from: playerFrom, to: player.position });
      emit(state, { type: "playerMoved", playerId: target.id, from: targetFrom, to: target.position });
      const targetTile = state.map.tiles[player.position];
      addHistory(
        state,
        `${player.name}用${scrollName}与${target.name}交换了位置，落在「${targetTile.label}」。`,
      );
      // 只有出牌者结算新格子；目标那一侧按规则什么都不触发
      resolveTile(state, targetTile);
      return;
    }
  }
}

/** 选定目标；候选名单由出牌时锁定，不接受客户端自行指定。 */
export function chooseScrollTarget(state: GameState, targetId: Player["id"]) {
  if (state.phase.kind !== "scrollTargetChoice") return false;
  const { playerId, candidateIds, scrollKind, effectIndex, resume } = state.phase.choice;
  if (!candidateIds.includes(targetId) || targetId === playerId) return false;
  const player = state.players[playerId];
  const target = state.players[targetId];
  if (!player || !target) return false;

  const definition = scrollDefinition(scrollKind);
  const effect = definition.effects[effectIndex];
  if (effect?.type !== "targetPlayer") return false;

  // 换位那一支会自己结算落点并定下阶段，所以先摆回默认阶段再施加效果
  state.phase = { kind: resume };
  applyTargetedScrollEffect(state, player, target, effect.apply, definition.name);
  return true;
}

/** 地图阶段使用；返回 false 时保持“非法动作不产生新状态”的约定。 */
export function useMapScroll(
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

  const advance = definition.effects.find(
    (effect): effect is Extract<ScrollEffectDefinition, { type: "advanceTiles" }> =>
      effect.type === "advanceTiles",
  );
  if (advance) {
    return useAdvanceScroll(
      state,
      player,
      instanceId,
      owned.kind,
      definition,
      Math.max(1, Math.floor(advance.distance)),
    );
  }

  const targetedIndex = definition.effects.findIndex((effect) => effect.type === "targetPlayer");
  if (targetedIndex >= 0) {
    const targeted = definition.effects[targetedIndex];
    if (targeted.type !== "targetPlayer") return false;
    return useTargetedScroll(
      state,
      player,
      instanceId,
      owned.kind,
      definition,
      targeted,
      targetedIndex,
    );
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

