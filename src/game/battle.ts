import { equipmentDefinition } from "./content/equipment";
import {
  applyPvpPenaltyReplacement,
  bonusPveVictoryScrolls,
  detachBlessing,
  receiveTransferredBlessing,
} from "./blessings";
import { findPreviousRestTile, findRestTileAtOrBefore } from "./map";
import { grantRandomResourceReward, grantScroll, rewardSecret } from "./resources";
import { enemyStats, getAttack, getDefense } from "./selectors";
import { addHistory, emit, makeInstanceId, nextRandom, rollDie } from "./state";
import type {
  EquipmentDamageContext,
  EquipmentEffects,
} from "./effects/cardEffects";
import type {
  BattleState,
  CombatSide,
  EliteAffixKind,
  EnemyKind,
  GameState,
  OwnedEquipment,
  OwnedScroll,
  Player,
  PlayerId,
  PlayerStats,
  ScrollChoice,
} from "./types";

/**
 * 战斗的生命周期与血量：开战、结束、伤害、治疗、双方查询。
 *
 * 与 battleRound.ts 的分界是「跨回合」与「单回合」——这里的事情一场战斗里只发生
 * 一次或几次（开战、某一方倒下、临时牌与暗格回收），一轮之内的投骰与效果结算在那边。
 * 依赖只朝一个方向走：battleRound 用得到这里的函数，反过来没有。
 */

/** 折算过词缀的敌方属性。b 侧是玩家时不该调用。 */
export function battleEnemyStats(battle: BattleState) {
  return enemyStats(battle.enemyId!, battle.enemyAffix);
}

export function combatantName(state: GameState, battle: BattleState, side: CombatSide) {
  if (side === "a") return state.players[battle.aPlayerId].name;
  if (battle.bPlayerId) return state.players[battle.bPlayerId].name;
  return battleEnemyStats(battle).name;
}

export function startBattle(
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

export function battlePlayerForSide(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.aPlayerId : battle.bPlayerId;
}

export function sideStats(state: GameState, battle: BattleState, side: CombatSide) {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) {
    const player = state.players[playerId];
    return { attack: getAttack(player), defense: getDefense(player) };
  }
  const enemy = battleEnemyStats(battle);
  return { attack: enemy.attack, defense: enemy.defense };
}

export function sideHp(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.hpA : battle.hpB;
}

export function sideMaxHp(state: GameState, battle: BattleState, side: CombatSide) {
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

export function finishPvp(state: GameState, battle: BattleState, winnerSide: CombatSide) {
  const winnerId = battlePlayerForSide(battle, winnerSide)!;
  const loserId = battlePlayerForSide(battle, winnerSide === "a" ? "b" : "a")!;
  const loser = state.players[loserId];
  const winner = state.players[winnerId];
  const tileIndex = state.players[state.activePlayerId].position;
  const penaltyWaived = applyPvpPenaltyReplacement(state, loser);
  const offeredBlessing = detachBlessing(state, loser);

  if (offeredBlessing && winner.blessings.length > 0) {
    state.phase = {
      kind: "blessingChoice",
      choice: {
        winnerId,
        loserId,
        offered: offeredBlessing,
        tileIndex,
        penaltyWaived: penaltyWaived || undefined,
      },
    };
    addHistory(
      state,
      `${winner.name}赢得相遇战，需要决定是否用${loser.name}的赐福覆盖自己的赐福${
        penaltyWaived
          ? `；${loser.name}的不屈意志同时生效，仅损失 1 点生命并免除正常代价`
          : ""
      }。`,
    );
    return;
  }

  if (offeredBlessing) {
    receiveTransferredBlessing(state, winner, loserId, offeredBlessing);
  }

  // 后退永远付得出，所以这里没有"付不起"的分支——代价阶段一定有路可走
  state.phase = {
    kind: "pvpPenalty",
    penalty: { winnerId, loserId, tileIndex, waived: penaltyWaived || undefined },
  };
  addHistory(
    state,
    `${winner.name}赢得相遇战${
      offeredBlessing
        ? `并夺得${loser.name}的赐福`
        : ""
    }，${
      penaltyWaived
        ? `${loser.name}的不屈意志生效，仅损失 1 点生命并免除正常代价。`
        : `${loser.name}需要选择代价。`
    }`,
  );
}

/**
 * PvE / Boss 战中 a 侧的临时生命值就是真实生命值，直接同步。
 * 这里刻意不发 playerHpChanged——变化已经由 battleDamage 描述，
 * 界面按 targetSide 映射回玩家即可，避免同一次掉血产生两条事件。
 */
export function syncPveHp(state: GameState, battle: BattleState) {
  if (battle.kind !== "pvp") {
    state.players[battle.aPlayerId].hp = Math.max(0, battle.hpA);
  }
}

export function choiceFor(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.choiceA : battle.choiceB;
}

export function setChoice(battle: BattleState, side: CombatSide, choice: ScrollChoice) {
  if (side === "a") battle.choiceA = choice;
  else battle.choiceB = choice;
}

/** 新一轮开始时重置双方选择；敌人一侧直接视为已提交 */
export function resetChoices(battle: BattleState) {
  battle.choiceA = { status: "pending" };
  battle.choiceB = battle.bPlayerId ? { status: "pending" } : { status: "declined" };
}

export function chosenInstanceIds(choice: ScrollChoice): readonly string[] {
  return choice.status === "chosen" ? choice.instanceIds : [];
}

export function finishBattle(state: GameState, battle: BattleState, winnerSide: CombatSide) {
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
      const bonusScrolls = Array.from(
        { length: bonusPveVictoryScrolls(player) },
        () => grantScroll(state, player),
      );
      if (!reward.pendingEquipmentChoice) {
        state.phase = { kind: "turnComplete" };
      }
      // 战报里用折算后的名字，精英怪才不会在这一句退回成普通怪
      const enemyName = battleEnemyStats(battle).name;
      const line = (what: string) => `${player.name}击败${enemyName}，获得${what}。`;
      const combinedReward = bonusScrolls.length > 0
        ? {
            name: `${reward.name}，并因战争财阀额外获得${bonusScrolls.map((item) => item.name).join("、")}`,
            publicName: `${reward.publicName}，并因战争财阀额外获得${bonusScrolls.map((item) => item.publicName).join("、")}`,
          }
        : reward;
      addHistory(
        state,
        line(combinedReward.name),
        rewardSecret(player, line, combinedReward),
      );
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
/**
 * 受击方装备的减伤钩子，返回实际该扣的伤害。
 *
 * 只接受更小的结果，见 EquipmentDamageContext.damage：多件装备一起挂钩子时，
 * 结算顺序就影响不了最终数值。敌人一侧没有装备，forEachEquipmentEffects 会安静跳过。
 */
function applyEquipmentBeforeDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  incoming: number,
) {
  let damage = incoming;
  const ownHp = sideHp(battle, targetSide);
  // 两个改伤函数都收敛到这里，钳一次就够——外面再也没有别的路能改这个值
  const shrinkTo = (value: number) => {
    damage = Math.min(damage, Math.max(0, value));
  };
  forEachEquipmentEffects(state, battle, targetSide, (effects, item, player) => {
    if (!effects.beforeDamage) return;
    const context: EquipmentDamageContext = {
      state,
      battle,
      side: targetSide,
      sourceSide,
      player,
      item,
      ownHp,
      ownMaxHp: sideMaxHp(state, battle, targetSide),
      incoming,
      reduceDamage: (by) => shrinkTo(damage - Math.max(0, by)),
      keepAtLeast: (hp) => shrinkTo(ownHp - Math.max(0, hp)),
      addBattleLog(text) {
        battle.log.unshift(text);
        battle.log = battle.log.slice(0, 8);
      },
    };
    effects.beforeDamage(context);
  });
  return damage;
}

/**
 * 战斗内唯一真正动血条的地方，返回目标是否已被打倒。
 *
 * 攻防结算和卷轴直伤以前各写了一遍同样的五步——记 hpBefore、夹到 0、发 battleDamage、
 * 写战报、同步 PvE 真实血量。两处都对，但没有任何东西保证它们继续对得上。
 *
 * 这里刻意只管扣血，不碰受击钩子：**「损失生命」和「受到伤害」不是一回事**。
 * 黑日碎片那类自损写的是前者，走伤害管线的话灰铁胸甲会拿自损当"本场第一次受到伤害"
 * 白吃掉一次充能，不灭王铠也会替你挡住自己的代价——两件护甲反而让高代价装备变安全，
 * 正好把它的设计意图倒过来。所以伤害是这个函数的一层包装（见 dealBattleDamage），
 * 而不是反过来。
 */
export function applyBattleHpLoss(
  state: GameState,
  battle: BattleState,
  targetSide: CombatSide,
  amount: number,
  logLine: string,
) {
  const loss = Math.max(0, amount);
  const hpBefore = sideHp(battle, targetSide);
  if (targetSide === "a") battle.hpA = Math.max(0, battle.hpA - loss);
  else battle.hpB = Math.max(0, battle.hpB - loss);
  const hpAfter = sideHp(battle, targetSide);
  emit(state, {
    type: "battleDamage",
    targetSide,
    amount: loss,
    hpBefore,
    hpAfter,
    hpMax: sideMaxHp(state, battle, targetSide),
  });
  battle.log.unshift(logLine);
  battle.log = battle.log.slice(0, 8);
  syncPveHp(state, battle);
  return hpAfter <= 0;
}

/**
 * 一次真正的伤害：先过受击方的减伤钩子，再扣血。返回目标是否已被打倒。
 *
 * 攻防结算和卷轴直伤都从这里落地，所以 beforeDamage 只有这一个挂载点。
 * 战报文案两处不同，所以由调用方给 logLine，它拿到的是钩子改完后的最终伤害。
 */
export function dealBattleDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  rawDamage: number,
  logLine: (damage: number) => string,
) {
  const damage = applyEquipmentBeforeDamage(
    state,
    battle,
    sourceSide,
    targetSide,
    Math.max(0, rawDamage),
  );
  return applyBattleHpLoss(state, battle, targetSide, damage, logLine(damage));
}

export function applyDirectScrollDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  rawDamage: number,
  effectName: string,
) {
  // 读取当前总防御（基础值 + 装备），但不投防御骰。
  const damage = Math.max(0, rawDamage - sideStats(state, battle, targetSide).defense);
  return dealBattleDamage(
    state,
    battle,
    sourceSide,
    targetSide,
    damage,
    (dealt) =>
      `${combatantName(state, battle, sourceSide)}使用${effectName}，${combatantName(state, battle, targetSide)}受到 ${dealt} 点伤害。`,
  );
}

export function applyBattleHealing(
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

/**
 * 遍历该侧玩家身上带自定义效果的装备。
 * 敌人一侧没有玩家，自然也没有装备，直接跳过。
 */
export function forEachEquipmentEffects(
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

/**
 * 战斗开始时的装备钩子，目前用于发临时牌。
 *
 * 发出去的牌带 temporary 标记，由 dropTemporaryScrolls 在战斗结束时回收。
 */
export function applyEquipmentBattleStart(
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
      random: () => nextRandom(state),
      addBattleLog(text) {
        battle.log.unshift(text);
        battle.log = battle.log.slice(0, 8);
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
export function dropTemporaryScrolls(state: GameState) {
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
export function clearBattleMemos(state: GameState) {
  for (const player of Object.values(state.players)) {
    for (const item of player.equipment) delete item.battleMemo;
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
