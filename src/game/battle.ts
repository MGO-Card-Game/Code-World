import { enemyDefinition } from "./content/enemies";
import { equipmentDefinition, pickEquipmentKind } from "./content/equipment";
import { REWARD_RARITY_TIERS } from "./content/rarity";
import {
  bonusPveVictoryScrolls,
  detachBlessing,
  hasFreeBlessingSlot,
  receiveTransferredBlessing,
  respawnsInPlaceOnDefeat,
} from "./blessings";
import { regionForPosition } from "./map";
import {
  grantEquipment,
  grantRandomResourceReward,
  grantScroll,
  rewardSecret,
} from "./resources";
import {
  enemyEffects,
  enemyStats,
  getAttack,
  getDefense,
  getDieSidesBonus,
  pvpHpTransferAmount,
} from "./selectors";
import { addHistory, emit, makeInstanceId, nextRandom, rollDie } from "./state";
import { ECONOMY, grantGold, pvpGoldTransferAmount } from "./economy";
import { battleHasEliteEnemy } from "./enemyClassification";
import { nextStage, recordEliteVictory, restAtStageCamp, stageBossUnlocked } from "./stages";
import type {
  EnemyDamageContext,
  EnemyEffects,
} from "./effects/battleHooks";
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
  PveRewardItem,
  PveRewardNoticeState,
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

/**
 * 先攻骰：玩家自由投 1-6，怪物按自身特征收窄——fixed 钉死点数，
 * range 只收窄上下界。没声明 initiative 的怪和玩家同规则，直接投白板骰。
 */
function rollInitiative(state: GameState, enemyId?: EnemyKind) {
  const initiative = enemyId ? enemyDefinition(enemyId).initiative : undefined;
  if (!initiative) return rollDie(state);
  if (initiative.type === "fixed") return initiative.value;
  const { min, max } = initiative;
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

/** 玩家先攻骰会叠加装备与赐福提供的骰面上限修正。 */
function rollPlayerInitiative(state: GameState, playerId: PlayerId) {
  const sides = Math.max(2, 6 + getDieSidesBonus(state.players[playerId], "initiative"));
  return rollDie(state, sides);
}

export function startBattle(
  state: GameState,
  kind: BattleState["kind"],
  aPlayerId: PlayerId,
  enemyId?: EnemyKind,
  bPlayerId?: PlayerId,
  enemyAffix?: EliteAffixKind,
  context?: { stageId?: GameState["map"]["regions"][number]["id"]; tileIndex?: number },
) {
  emit(state, {
    type: "battleStarted",
    battleKind: kind,
    aPlayerId,
    bPlayerId,
    enemyId,
    enemyAffix,
  });
  let initiativeA = rollPlayerInitiative(state, aPlayerId);
  let initiativeB = bPlayerId
    ? rollPlayerInitiative(state, bPlayerId)
    : rollInitiative(state, enemyId);
  while (initiativeA === initiativeB) {
    initiativeA = rollPlayerInitiative(state, aPlayerId);
    initiativeB = bPlayerId
      ? rollPlayerInitiative(state, bPlayerId)
      : rollInitiative(state, enemyId);
  }
  const battle: BattleState = {
    kind,
    aPlayerId,
    bPlayerId,
    enemyId,
    enemyAffix,
    stageId: context?.stageId,
    tileIndex: context?.tileIndex,
    hpA: state.players[aPlayerId].hp,
    // 精英词缀会抬高血量上限，所以这里必须走折算，不能直接读定义
    hpB: bPlayerId ? state.players[bPlayerId].hp : enemyStats(enemyId!, enemyAffix).maxHp,
    attacker: initiativeA > initiativeB ? "a" : "b",
    initiativeA,
    initiativeB,
    round: 1,
    log: [],
    scrollsUsedA: 0,
    scrollsUsedB: 0,
    enemyAttacksPerformed: 0,
    nextPlayerAttackPenalty: 0,
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

/** 不计装备、赐福与精英词缀的一侧基础攻防。 */
export function sideBaseStats(state: GameState, battle: BattleState, side: CombatSide) {
  const playerId = battlePlayerForSide(battle, side);
  if (playerId) {
    const player = state.players[playerId];
    return { attack: player.baseAttack, defense: player.baseDefense };
  }
  const enemy = enemyDefinition(battle.enemyId!);
  return { attack: enemy.attack, defense: enemy.defense };
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

export function sideScrollsUsed(battle: BattleState, side: CombatSide) {
  return side === "a" ? battle.scrollsUsedA : battle.scrollsUsedB;
}

/** 记下这一侧本回合打出的牌数，供「对手每用一张卷轴……」这类效果读取。 */
export function countScrollUse(battle: BattleState, side: CombatSide, count: number) {
  if (side === "a") battle.scrollsUsedA += count;
  else battle.scrollsUsedB += count;
}

export function finishPvp(state: GameState, battle: BattleState, winnerSide: CombatSide) {
  const winnerId = battlePlayerForSide(battle, winnerSide)!;
  const loserId = battlePlayerForSide(battle, winnerSide === "a" ? "b" : "a")!;
  const loser = state.players[loserId];
  const winner = state.players[winnerId];
  const tileIndex = state.players[state.activePlayerId].position;
  const noPayablePenalty =
    pvpGoldTransferAmount(loser) === 0 &&
    loser.scrolls.length === 0 &&
    loser.equipment.length === 0 &&
    pvpHpTransferAmount(winner, loser) === 0;
  const penaltyWaiveReason = noPayablePenalty ? "noPayable" as const : undefined;
  const offeredBlessing = detachBlessing(state, loser);

  if (offeredBlessing && !hasFreeBlessingSlot(winner)) {
    state.phase = {
      kind: "blessingChoice",
      choice: {
        source: "pvp",
        winnerId,
        loserId,
        offered: offeredBlessing,
        tileIndex,
        penaltyWaived: noPayablePenalty || undefined,
        penaltyWaiveReason,
      },
    };
    addHistory(
      state,
      `${winner.name}赢得相遇战，但赐福槽位已满，需要决定是否用${loser.name}的赐福替换一个已有赐福${
        noPayablePenalty
          ? `；${loser.name}没有可支付的金币、资源或生命，免除本次代价`
          : ""
      }。`,
    );
    return;
  }

  if (offeredBlessing) {
    receiveTransferredBlessing(state, winner, loserId, offeredBlessing);
  }

  state.phase = {
    kind: "pvpPenalty",
    penalty: {
      winnerId,
      loserId,
      tileIndex,
      waived: noPayablePenalty || undefined,
      waiveReason: penaltyWaiveReason,
    },
  };
  addHistory(
    state,
    `${winner.name}赢得相遇战${
      offeredBlessing
        ? `并夺得${loser.name}的赐福`
        : ""
    }，${
      noPayablePenalty
        ? `${loser.name}没有可支付的金币、资源或生命，本次不再承受额外代价。`
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

/** 奖励条目在战报里的连接词；数组第一项直接写名字，后面的按来源接。 */
const REWARD_CONNECTORS: Record<PveRewardItem["source"], string> = {
  battle: "并获得",
  boss: "并获得",
  elite: "并因击败精英额外获得",
  affix: "并因击败词条敌人额外获得",
  blessing: "并因战争财阀额外获得",
};

/**
 * 把奖励弹层挂上去。
 *
 * 装备槽满时 grantEquipment 已经把阶段换成了 equipmentChoice，这时不能直接覆盖它，
 * 只能把弹层塞进它的 resume——否则玩家的替换/放弃选择会被这一行吞掉。
 */
function presentRewardNotice(
  state: GameState,
  notice: PveRewardNoticeState,
  pendingEquipmentChoice: boolean | undefined,
) {
  if (!pendingEquipmentChoice) {
    state.phase = { kind: "pveReward", notice };
    return;
  }
  if (state.phase.kind !== "equipmentChoice") {
    throw new Error("装备奖励等待选择时应处于 equipmentChoice 阶段");
  }
  state.phase.choice.resume = { kind: "showPveReward", notice };
}

/** 一句话写完这一堆奖励，暗牌部分交给 rewardSecret 折成旁观者版本。 */
function announceRewards(
  state: GameState,
  player: Player,
  rewards: readonly PveRewardItem[],
  line: (what: string) => string,
) {
  const describeRewards = (publicView: boolean) => rewards
    .map((item, index) => {
      const name = publicView ? item.publicName : item.name;
      return index === 0 ? name : `${REWARD_CONNECTORS[item.source]}${name}`;
    })
    .join("，");
  const combined = { name: describeRewards(false), publicName: describeRewards(true) };
  addHistory(state, line(combined.name), rewardSecret(player, line, combined));
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
    // 战报里用折算后的名字，精英怪才不会在这一句退回成普通怪
    const enemyName = battleEnemyStats(battle).name;
    if (battle.kind === "boss") {
      const stageId = battle.stageId;
      const region = stageId
        ? state.map.regions.find((candidate) => candidate.id === stageId)
        : undefined;
      const following = stageId ? nextStage(state.map, stageId) : undefined;
      if (stageId && region && following) {
        player.stageProgress[stageId].bossDefeated = true;
        const from = player.position;
        player.position = following.entryIndex;
        emit(state, { type: "playerMoved", playerId: player.id, from, to: player.position });
        addHistory(state, `${player.name}击败${enemyName}，进入${following.name}！`);
        // 落点就是下一阶段营地，回血走营地那条规则，不在首领奖励里另开一份
        restAtStageCamp(state, player, following);
        const revealAfterEventId = state.lastEvents.at(-1)?.id;

        const bossGold = grantGold(state, player, ECONOMY.bossGold, "pveReward");
        const scrollReward = grantScroll(state, player);
        // 装备放在最后发：槽位满时它会把阶段切成 equipmentChoice，后面的授奖就没地方落了
        const equipmentReward = grantEquipment(
          state,
          player,
          pickEquipmentKind(
            () => nextRandom(state),
            {
              rarityWeights: REWARD_RARITY_TIERS.premium,
              minRarity: region.bossEquipmentFloor,
            },
          ),
        );
        const rewards: PveRewardItem[] = [
          {
            source: "boss",
            resourceType: "gold",
            name: `${bossGold} 金币`,
            publicName: `${bossGold} 金币`,
          },
          {
            source: "boss",
            resourceType: scrollReward.resourceType,
            name: scrollReward.name,
            publicName: scrollReward.publicName,
          },
          {
            source: "boss",
            resourceType: equipmentReward.resourceType,
            name: equipmentReward.name,
            publicName: equipmentReward.publicName,
          },
        ];
        presentRewardNotice(
          state,
          {
            playerId: player.id,
            enemyName,
            elite: false,
            rewards,
            statGrowth: true,
            revealAfterEventId,
          },
          equipmentReward.pendingEquipmentChoice,
        );
        announceRewards(
          state,
          player,
          rewards,
          (what) => `${player.name}在${following.name}清点首领的战利品，获得${what}。`,
        );
      } else {
        if (stageId) player.stageProgress[stageId].bossDefeated = true;
        state.phase = { kind: "gameOver", winnerId: player.id };
        emit(state, { type: "gameOver", winnerId: player.id });
        addHistory(state, `${player.name}击败峰顶巨龙，夺得登峰之冠！`);
      }
    } else {
      const eliteEnemy = battleHasEliteEnemy(battle);
      const affixedEnemy = battle.enemyAffix !== undefined;
      if (eliteEnemy && battle.stageId) {
        const region = state.map.regions.find((candidate) => candidate.id === battle.stageId)!;
        const wasUnlocked = stageBossUnlocked(player, region);
        recordEliteVictory(player, battle.stageId);
        if (!wasUnlocked && stageBossUnlocked(player, region)) {
          addHistory(state, `${player.name}已满足${region.name}的首领挑战条件！`);
        }
      }
      const revealAfterEventId = state.lastEvents.at(-1)?.id;
      const eliteReward = eliteEnemy ? grantScroll(state, player) : undefined;
      // 精英固定给卷轴和装备；装备放在最后发，槽位满时才能安全接入替换阶段。
      const reward = eliteEnemy
        ? grantEquipment(
          state,
          player,
          pickEquipmentKind(() => nextRandom(state), {
            rarityWeights: REWARD_RARITY_TIERS.standard,
          }),
        )
        : grantRandomResourceReward(
          state,
          player,
          undefined,
          { rarityWeights: REWARD_RARITY_TIERS.meager },
        );
      const battleGold = grantGold(state, player, ECONOMY.pveGold, "pveReward");
      const eliteGold = eliteEnemy
        ? grantGold(state, player, ECONOMY.eliteBonusGold, "pveReward")
        : 0;
      const affixGold = affixedEnemy
        ? grantGold(state, player, ECONOMY.affixBonusGold, "pveReward")
        : 0;
      const blessingRewards = Array.from(
        { length: bonusPveVictoryScrolls(player) },
        () => grantScroll(state, player),
      );
      const rewards: PveRewardItem[] = [
        {
          source: "battle",
          resourceType: reward.resourceType,
          name: reward.name,
          publicName: reward.publicName,
        },
        {
          source: "battle",
          resourceType: "gold",
          name: `${battleGold} 金币`,
          publicName: `${battleGold} 金币`,
        },
        ...(eliteReward ? [{
          source: "elite" as const,
          resourceType: eliteReward.resourceType,
          name: eliteReward.name,
          publicName: eliteReward.publicName,
        }] : []),
        ...(eliteGold > 0 ? [{
          source: "elite" as const,
          resourceType: "gold" as const,
          name: `${eliteGold} 金币`,
          publicName: `${eliteGold} 金币`,
        }] : []),
        ...(affixGold > 0 ? [{
          source: "affix" as const,
          resourceType: "gold" as const,
          name: `${affixGold} 金币`,
          publicName: `${affixGold} 金币`,
        }] : []),
        ...blessingRewards.map((item) => ({
          source: "blessing" as const,
          resourceType: item.resourceType,
          name: item.name,
          publicName: item.publicName,
        })),
      ];
      presentRewardNotice(
        state,
        {
          playerId: player.id,
          enemyName,
          elite: eliteEnemy,
          rewards,
          revealAfterEventId,
        },
        reward.pendingEquipmentChoice,
      );
      announceRewards(
        state,
        player,
        rewards,
        (what) => `${player.name}击败${enemyName}，获得${what}。`,
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
  // 退回落点不结算格子效果，所以站回营地也不会触发营地的回满血。
  const inPlace = respawnsInPlaceOnDefeat(player);
  if (!inPlace) {
    player.position = regionForPosition(state.map, player.position).entryIndex;
  }
  emit(state, {
    type: "playerHpChanged",
    playerId: player.id,
    from: hpBeforeRecovery,
    to: player.hp,
    maxHp: player.maxHp,
    reason: "defeatRecovery",
  });
  if (!inPlace) {
    emit(state, {
      type: "playerRetreated",
      playerId: player.id,
      from: positionBefore,
      to: player.position,
    });
  }
  state.phase = { kind: "turnComplete" };
  addHistory(
    state,
    inPlace
      ? `${player.name}战败，不屈意志生效，原地恢复至半血。`
      : `${player.name}战败，恢复至半血并退回阶段营地。`,
  );
}

/** 返回目标是否被卷轴直接击败。 */
/**
 * 受击方的减伤钩子，返回实际该扣的伤害。
 *
 * 只接受更小的结果，见 EquipmentDamageContext.damage：多个钩子一起挂时，
 * 结算顺序就影响不了最终数值。装备与怪物两条通路写在同一个函数里而不是各跑一遍，
 * 是因为"只能改小"这件事必须由同一个 shrinkTo 收口——两处各夹一次的话，
 * 装备减免完再让怪物封顶，和反过来算，结果就不一样了。
 * 两个遍历各自会跳过不适用的一侧：敌人没有装备，玩家没有怪物效果。
 */
function applyBeforeDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  incoming: number,
) {
  let damage = incoming;
  const ownHp = sideHp(battle, targetSide);
  const ownMaxHp = sideMaxHp(state, battle, targetSide);
  let minimumHpAfter = 0;
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
      ownMaxHp,
      incoming,
      reduceDamage: (by) => shrinkTo(damage - Math.max(0, by)),
      keepAtLeast: (hp) => {
        const floor = Math.min(ownMaxHp, Math.max(0, hp));
        minimumHpAfter = Math.max(minimumHpAfter, floor);
        shrinkTo(ownHp - floor);
      },
      addBattleLog(text) {
        battle.log.unshift(text);
        battle.log = battle.log.slice(0, 8);
      },
    };
    effects.beforeDamage(context);
  });
  forEachEnemyEffects(battle, targetSide, (effects) => {
    if (!effects.beforeDamage) return;
    const context: EnemyDamageContext = {
      state,
      battle,
      side: targetSide,
      sourceSide,
      ownHp,
      ownMaxHp,
      incoming,
      reduceDamage: (by) => shrinkTo(damage - Math.max(0, by)),
      capDamage: (max) => shrinkTo(max),
      addBattleLog(text) {
        battle.log.unshift(text);
        battle.log = battle.log.slice(0, 8);
      },
    };
    effects.beforeDamage(context);
  });
  return { damage, minimumHpAfter };
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
  const { damage, minimumHpAfter } = applyBeforeDamage(
    state,
    battle,
    sourceSide,
    targetSide,
    Math.max(0, rawDamage),
  );
  const defeated = applyBattleHpLoss(
    state,
    battle,
    targetSide,
    damage,
    logLine(damage),
  );
  const hpAfterDamage = sideHp(battle, targetSide);
  if (minimumHpAfter > hpAfterDamage) {
    applyBattleHealing(
      state,
      battle,
      targetSide,
      minimumHpAfter - hpAfterDamage,
      "不灭王铠",
    );
  }
  return defeated && sideHp(battle, targetSide) <= 0;
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

/** 怪物能力的防御值减免直伤；仍经过装备与怪物的受击钩子。 */
export function applyEnemyAbilityDamage(
  state: GameState,
  battle: BattleState,
  sourceSide: CombatSide,
  targetSide: CombatSide,
  rawDamage: number,
  abilityName: string,
) {
  const damage = Math.max(0, rawDamage - sideStats(state, battle, targetSide).defense);
  return dealBattleDamage(
    state,
    battle,
    sourceSide,
    targetSide,
    damage,
    (dealt) =>
      `${combatantName(state, battle, sourceSide)}发动${abilityName}，${combatantName(state, battle, targetSide)}受到 ${dealt} 点伤害。`,
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
 * 遍历该侧敌人的效果：本体的，加上精英词缀的。
 * 该侧是玩家时没有敌人，直接跳过——正好和 forEachEquipmentEffects 互补。
 */
export function forEachEnemyEffects(
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
