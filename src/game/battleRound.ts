import { SCROLLS } from "./content/scrolls";
import {
  applyBattleHealing,
  applyBattleHpLoss,
  applyDirectScrollDamage,
  applyEnemyAbilityDamage,
  battlePlayerForSide,
  choiceFor,
  chosenInstanceIds,
  combatantName,
  countScrollUse,
  dealBattleDamage,
  finishBattle,
  forEachEnemyEffects,
  forEachEquipmentEffects,
  resetChoices,
  setChoice,
  sideBaseStats,
  sideHp,
  sideMaxHp,
  sideScrollsUsed,
  sideStats,
} from "./battle";
import { consumeScrolls } from "./resources";
import { applyBlessingCombatRoll } from "./blessings";
import {
  enemyDiceCountBonus,
  enemyDieSidesBonus,
  getDiceCountBonus,
  getDieSidesBonus,
  playableScrolls,
} from "./selectors";
import { emit, nextRandom, rollDie } from "./state";
import type {
  BattleEffectContext,
  BattleHookContext,
  RollModifiers,
  RollResult,
} from "./effects/battleHooks";
import type {
  EquipmentBattleContext,
  ScrollEffectDefinition,
} from "./effects/cardEffects";
import type {
  BattleState,
  CombatSide,
  GameState,
  OwnedEquipment,
  Player,
  ScrollKind,
  ScrollTiming,
} from "./types";

/**
 * 一个攻击回合的结算：卷轴效果、投骰、装备与怪物钩子的分发。
 *
 * 这里是新卡最常落地的地方，所以刻意和战斗生命周期分开——加一种效果词汇或一个
 * 钩子时机，改动都收在这个文件里，不必去翻开战与结束的流程。
 */

export function newRollModifiers(): RollModifiers {
  return {
    flatBonus: 0,
    dieSidesBonus: 0,
    dieSidesCap: Number.MAX_SAFE_INTEGER,
    extraDice: 0,
    rollAttempts: 1,
    rollSelection: "highest",
    extremeFaces: false,
    minimumRoll: 1,
    maxRollDice: 0,
    fixedRollDice: 0,
    fixedRollValue: 0,
    bonusDamage: 0,
    minimumDamage: 0,
    extraAttacks: 0,
    damageReduction: 0,
    damageCap: Number.MAX_SAFE_INTEGER,
    postRoundSelfHpLoss: 0,
  };
}

function oppositeSide(side: CombatSide): CombatSide {
  return side === "a" ? "b" : "a";
}

function addNextAttackDieSidesPenalty(
  battle: BattleState,
  side: CombatSide,
  amount: number,
) {
  if (side === "a") {
    battle.nextAttackDieSidesPenaltyA = (battle.nextAttackDieSidesPenaltyA ?? 0) + amount;
  } else {
    battle.nextAttackDieSidesPenaltyB = (battle.nextAttackDieSidesPenaltyB ?? 0) + amount;
  }
}

function takeNextAttackDieSidesPenalty(battle: BattleState, side: CombatSide) {
  const amount = side === "a"
    ? battle.nextAttackDieSidesPenaltyA ?? 0
    : battle.nextAttackDieSidesPenaltyB ?? 0;
  if (side === "a") delete battle.nextAttackDieSidesPenaltyA;
  else delete battle.nextAttackDieSidesPenaltyB;
  return amount;
}

function addNextAttackRollPenalty(
  battle: BattleState,
  side: CombatSide,
  amount: number,
) {
  if (side === "a") {
    battle.nextAttackRollPenaltyA = (battle.nextAttackRollPenaltyA ?? 0) + amount;
  } else {
    battle.nextAttackRollPenaltyB = (battle.nextAttackRollPenaltyB ?? 0) + amount;
  }
}

function takeNextAttackRollPenalty(battle: BattleState, side: CombatSide) {
  const amount = side === "a"
    ? battle.nextAttackRollPenaltyA ?? 0
    : battle.nextAttackRollPenaltyB ?? 0;
  if (side === "a") delete battle.nextAttackRollPenaltyA;
  else delete battle.nextAttackRollPenaltyB;
  return amount;
}

function markSkipNextAttack(battle: BattleState, side: CombatSide) {
  if (side === "a") battle.skipNextAttackA = true;
  else battle.skipNextAttackB = true;
}

function takeSkipNextAttack(battle: BattleState, side: CombatSide) {
  const skipped = side === "a" ? battle.skipNextAttackA : battle.skipNextAttackB;
  if (side === "a") delete battle.skipNextAttackA;
  else delete battle.skipNextAttackB;
  return skipped === true;
}

export function applyScrollEffect(
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
      return undefined;
    case "dieSides":
      /*
        取最大而不是后写覆盖。

        一回合可以打任意多张牌，两张换骰面的卷轴同时打出时，"谁生效"不能取决于
        提交顺序——那种依赖不会报错，只会让数值悄悄算错。取最大之后顺序在数学上
        就影响不了结果，也就不需要给每张卡维护优先级。
        rollModifiers.test.ts 有一条排列测试守着这个性质。
      */
      modifiers.sidesOverride = Math.max(modifiers.sidesOverride ?? 0, effect.sides);
      return undefined;
    case "dieSidesBonus":
      modifiers.dieSidesBonus += effect.value;
      return undefined;
    case "extraDice":
      modifiers.extraDice += effect.count;
      return undefined;
    case "rollTwice":
      modifiers.rollAttempts = Math.max(modifiers.rollAttempts, 2);
      return undefined;
    case "minimumRoll":
      modifiers.minimumRoll = Math.max(modifiers.minimumRoll, effect.value);
      return undefined;
    case "maxRoll":
      modifiers.maxRollDice += effect.count;
      return undefined;
    case "fixedRoll":
      modifiers.fixedRollDice += effect.count;
      // 颗数累加、点数取最大，理由同上面的 dieSides：一回合可以打任意多张牌，
      // 两张钉点数的卷轴撞在一起时，"谁生效"不能取决于提交顺序
      modifiers.fixedRollValue = Math.max(modifiers.fixedRollValue, effect.value);
      return undefined;
    case "directDamage": {
      const defeated = applyDirectScrollDamage(
        state,
        battle,
        sourceSide,
        targetSide,
        effect.amount,
        effectName,
      );
      return defeated ? sourceSide : undefined;
    }
    case "damageReduction":
      modifiers.damageReduction += Math.max(0, effect.amount);
      return undefined;
    case "damageCap":
      modifiers.damageCap = Math.min(modifiers.damageCap, Math.max(0, effect.amount));
      return undefined;
    case "selfHpLoss": {
      const defeated = applyBattleHpLoss(
        state,
        battle,
        sourceSide,
        effect.amount,
        `${combatantName(state, battle, sourceSide)}使用${effectName}，损失 ${effect.amount} 点生命。`,
      );
      return defeated ? targetSide : undefined;
    }
    case "postRoundSelfHpLoss":
      modifiers.postRoundSelfHpLoss += Math.max(0, effect.amount);
      return undefined;
    case "mutualDirectDamage": {
      const targetDefeated = applyDirectScrollDamage(
        state,
        battle,
        sourceSide,
        targetSide,
        effect.amount,
        effectName,
      );
      const sourceDefeated = applyDirectScrollDamage(
        state,
        battle,
        targetSide,
        sourceSide,
        effect.amount,
        effectName,
      );
      // 同时倒下时由出牌者承担赌命代价，目标一侧获胜。
      if (sourceDefeated) return targetSide;
      if (targetDefeated) return sourceSide;
      return undefined;
    }
    case "skipNextAttack":
      markSkipNextAttack(battle, sourceSide);
      return undefined;
    case "penalizeNextAttackDieSides":
      addNextAttackDieSidesPenalty(battle, targetSide, Math.max(0, effect.amount));
      return undefined;
    case "penalizeNextAttackRoll":
      addNextAttackRollPenalty(battle, targetSide, Math.max(0, effect.amount));
      return undefined;
    case "heal":
      applyBattleHealing(state, battle, sourceSide, effect.amount, effectName);
      return undefined;
    case "forfeitMovement": {
      const playerId = battlePlayerForSide(battle, sourceSide);
      if (playerId) state.players[playerId].skipNextMovement = { reason: "战地药剂" };
      battle.log.unshift(
        `${combatantName(state, battle, sourceSide)}将在下一次地图行动中无法移动。`,
      );
      battle.log = battle.log.slice(0, 8);
      return undefined;
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
      return targetDefeated || result?.targetDefeated === true ? sourceSide : undefined;
    }
  }
}

/**
 * 依次结算本侧本回合打出的全部卷轴，返回已经分出的胜方。
 *
 * 按提交顺序走，目标一倒就停手——后面的牌已经消耗掉了，只是效果不再结算。
 * 累加类效果（加值、骰数、骰面）与顺序无关，只有 directDamage / custom
 * 这类带副作用的会受顺序影响，见 RollModifiers 的说明。
 */
export function applyScrollEffects(
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
      const winner = applyScrollEffect(
          state,
          battle,
          sourceSide,
          targetSide,
          definition.name,
          effect,
          modifiers,
        );
      if (winner) return winner;
    }
  }
  return undefined;
}

export function rollForSide(
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
  const sides = Math.max(1, Math.min(
    modifiers.dieSidesCap,
    Math.max(2, (modifiers.sidesOverride ?? 6) + sidesBonus + modifiers.dieSidesBonus),
  ));
  const count = Math.max(1, 1 + modifiers.extraDice + countBonus);
  /*
    每颗骰子都照常掷一次再决定要不要覆盖，而不是"视为最高面就跳过投骰"。
    这样消耗的随机数个数只取决于骰子数量，与本次生效了哪些效果无关，
    同种子重放和对照调试才不会因为多了一张牌就整条随机流错位。
  */
  /*
    覆盖按 maxRollDice → fixedRollDice 的顺序分配骰子，两者不抢同一颗：
    拉满上限只赚不亏，钉死点数则可能更差，把好的那份先发出去，
    玩家同时打出两张时拿到的是唯一说得通的分配。
  */
  const fixedUntil = modifiers.maxRollDice + modifiers.fixedRollDice;
  const fixedValue = Math.min(sides, modifiers.fixedRollValue);
  const dice = Array.from({ length: count }, (_unused, index) => {
    const attempts = Array.from(
      { length: Math.max(1, modifiers.rollAttempts) },
      () => modifiers.extremeFaces
        ? (rollDie(state, 2) === 1 ? 1 : sides)
        : rollDie(state, sides),
    );
    const selected = modifiers.rollSelection === "lowest"
      ? Math.min(...attempts)
      : Math.max(...attempts);
    const roll = Math.min(
      sides,
      Math.max(modifiers.minimumRoll, selected),
    );
    if (index < modifiers.maxRollDice) return sides;
    // 钉死就是钉死，不再受 minimumRoll 抬举——这张牌的代价就是放弃上下两头
    if (index < fixedUntil) return fixedValue;
    return roll;
  });
  return {
    sides,
    dice,
    sum: dice.reduce((total, die) => total + die, 0),
  };
}

/** 不依赖某一次投骰的战斗效果上下文。 */
export function battleEffectContext(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
): BattleEffectContext {
  const ownBase = sideBaseStats(state, battle, side);
  const opponentBase = sideBaseStats(state, battle, opponentSide);
  return {
    state,
    battle,
    side,
    opponentSide,
    ownBaseAttack: ownBase.attack,
    ownBaseDefense: ownBase.defense,
    opponentBaseAttack: opponentBase.attack,
    opponentBaseDefense: opponentBase.defense,
    ownHp: sideHp(battle, side),
    ownMaxHp: sideMaxHp(state, battle, side),
    opponentHp: sideHp(battle, opponentSide),
    opponentMaxHp: sideMaxHp(state, battle, opponentSide),
    ownScrollsUsed: sideScrollsUsed(battle, side),
    opponentScrollsUsed: sideScrollsUsed(battle, opponentSide),
    addBattleLog(text) {
      battle.log.unshift(text);
      battle.log = battle.log.slice(0, 8);
    },
  };
}

/** 装备与怪物共用的投骰上下文。 */
export function battleHookContext(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
): BattleHookContext {
  return {
    ...battleEffectContext(state, battle, side, opponentSide),
    dieKind,
    modifiers,
  };
}

export function equipmentBattleContext(
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

/** 掷骰前的装备钩子。卷轴先结算完才轮到这里，见 EquipmentEffects。 */
export function applyEquipmentBeforeRoll(
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
export function applyEquipmentAfterRoll(
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

/**
 * 双方骰点都公开后的攻击方装备钩子。
 *
 * 只遍历攻击方，避免防守方装备借“对手攻击成功”错误地追加伤害。多个装备的
 * 追加伤害可以自然累加；随机数统一取自 GameState 的种子流。
 */
export function applyEquipmentAfterOpposedRoll(
  state: GameState,
  battle: BattleState,
  attackerSide: CombatSide,
  defenderSide: CombatSide,
  modifiers: RollModifiers,
  attackRoll: RollResult,
  defenseRoll: RollResult,
) {
  forEachEquipmentEffects(state, battle, attackerSide, (effects, item, player) => {
    effects.afterOpposedRoll?.({
      ...battleEffectContext(state, battle, attackerSide, defenderSide),
      player,
      item,
      attackRoll,
      defenseRoll,
      modifiers,
      random: () => nextRandom(state),
    });
  });
}

/** 双方骰点公开后的防守方装备钩子。 */
export function applyEquipmentAfterDefensiveOpposedRoll(
  state: GameState,
  battle: BattleState,
  defenderSide: CombatSide,
  attackerSide: CombatSide,
  modifiers: RollModifiers,
  attackRoll: RollResult,
  defenseRoll: RollResult,
) {
  forEachEquipmentEffects(state, battle, defenderSide, (effects, item, player) => {
    effects.afterDefensiveOpposedRoll?.({
      ...battleEffectContext(state, battle, defenderSide, attackerSide),
      player,
      item,
      attackRoll,
      defenseRoll,
      modifiers,
    });
  });
}

/**
 * 打完牌之后的装备钩子，每张牌各调用一次。返回这一侧是否因此倒下。
 *
 * 在战斗里，扣血走 applyBattleHpLoss 而不是 dealBattleDamage：牌面写的是
 * 「损失生命」，不该被灰铁胸甲和不灭王铠这类受击装备接管，理由见那个函数的说明。
 */
export function applyEquipmentScrollUse(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  kinds: readonly ScrollKind[],
) {
  let defeated = false;
  for (const kind of kinds) {
    forEachEquipmentEffects(state, battle, side, (effects, item, player) => {
      effects.onScrollUsed?.({
        state,
        battle,
        player,
        item,
        scroll: kind,
        loseHp(amount, logLine) {
          if (applyBattleHpLoss(state, battle, side, amount, logLine)) defeated = true;
        },
      });
    });
  }
  return defeated;
}

/** 掷骰前的怪物钩子，与装备钩子在流程里同一位置。 */
export function applyEnemyBeforeRoll(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
) {
  let opponentDefeated = false;
  forEachEnemyEffects(battle, side, (effects) => {
    if (opponentDefeated) return;
    effects.beforeRoll?.(
      {
        ...battleHookContext(state, battle, side, opponentSide, dieKind, modifiers),
        attacksPerformed: battle.enemyAttacksPerformed,
        dealDamage(rawDamage, abilityName) {
          opponentDefeated = applyEnemyAbilityDamage(
            state,
            battle,
            side,
            opponentSide,
            rawDamage,
            abilityName,
          );
          return opponentDefeated;
        },
      },
    );
  });
  return opponentDefeated;
}

/** 掷骰后的怪物钩子，能读到骰面结果。 */
export function applyEnemyAfterRoll(
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

/**
 * 一次怪物攻击完整结算后的钩子。防守方已被该次攻击击倒时，调用点会先结束战斗，
 * 因而不会走到这里——这让“第三击后自毁”不会把玩家已经输掉的战斗改判成胜利。
 */
export function applyEnemyAfterAttack(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  damageDealt: number,
) {
  if (battlePlayerForSide(battle, side)) return false;
  battle.enemyAttacksPerformed += 1;
  let defeated = false;
  forEachEnemyEffects(battle, side, (effects) => {
    effects.afterAttack?.({
      ...battleEffectContext(state, battle, side, opponentSide),
      attacksPerformed: battle.enemyAttacksPerformed,
      damageDealt,
      loseHp(amount, logLine) {
        const result = applyBattleHpLoss(state, battle, side, amount, logLine);
        if (result) defeated = true;
        return result;
      },
      penalizeNextPlayerAttack(by, logLine) {
        const penalty = Math.max(0, by);
        if (penalty <= 0) return;
        battle.nextPlayerAttackPenalty = Math.max(battle.nextPlayerAttackPenalty, penalty);
        battle.log.unshift(logLine);
        battle.log = battle.log.slice(0, 8);
      },
    });
  });
  return defeated;
}

/**
 * 一次攻击的完整结算：双方钩子、投骰、伤害落地、攻击后钩子。
 *
 * 从回合里单独拎出来，是因为一个攻击回合不再必然只含一次攻击——山匪头目的
 * 「动作如潮」会让同一个回合连打两次。卷轴刻意留在外面：它按回合结算一次，
 * 追加的攻击共用同一份卷轴修正，理由见 RollModifiers.extraAttacks。
 *
 * 每次结算都从基线**复制**一份修正：钩子改的是自己这一击，加值不该渗到下一击，
 * 一次性的骰面覆盖也不该在第二击里白送一遍。
 *
 * 返回战斗是否已经在这一击里分出胜负——若是，finishBattle 已经调用过了。
 */
function resolveAttackSettlement(
  state: GameState,
  battle: BattleState,
  attackerSide: CombatSide,
  defenderSide: CombatSide,
  attackBaseline: RollModifiers,
  defenseBaseline: RollModifiers,
): { finished: boolean; extraAttacks: number } {
  const attackModifiers = { ...attackBaseline };
  const defenseModifiers = { ...defenseBaseline };
  const attackerId = battlePlayerForSide(battle, attackerSide);
  const defenderId = battlePlayerForSide(battle, defenderSide);

  applyEquipmentBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  );
  applyEquipmentBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  );
  if (applyEnemyBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  )) {
    finishBattle(state, battle, attackerSide);
    return { finished: true, extraAttacks: 0 };
  }
  if (applyEnemyBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  )) {
    finishBattle(state, battle, defenderSide);
    return { finished: true, extraAttacks: 0 };
  }
  if (attackerId) applyBlessingCombatRoll(state.players[attackerId], attackModifiers);
  if (defenderId) applyBlessingCombatRoll(state.players[defenderId], defenseModifiers);
  if (attackerId && battle.nextPlayerAttackPenalty > 0) {
    const penalty = battle.nextPlayerAttackPenalty;
    battle.nextPlayerAttackPenalty = 0;
    attackModifiers.flatBonus -= penalty;
    battle.log.unshift(`霜冻侵蚀武器，本次攻击 -${penalty}。`);
    battle.log = battle.log.slice(0, 8);
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
  applyEquipmentAfterOpposedRoll(
    state,
    battle,
    attackerSide,
    defenderSide,
    attackModifiers,
    attackRoll,
    defenseRoll,
  );
  applyEquipmentAfterDefensiveOpposedRoll(
    state,
    battle,
    defenderSide,
    attackerSide,
    defenseModifiers,
    attackRoll,
    defenseRoll,
  );

  const attackBase = sideStats(state, battle, attackerSide).attack;
  const defenseBase = sideStats(state, battle, defenderSide).defense;
  const attackBonus = attackModifiers.flatBonus;
  const defenseBonus = defenseModifiers.flatBonus;
  const attackTotal = attackBase + attackRoll.sum + attackBonus;
  const defenseTotal = defenseBase + defenseRoll.sum + defenseBonus;
  // bonusDamage 不吃防御值，但仍属于本次最终伤害，可以被闪避类效果减免
  const damage = Math.min(
    defenseModifiers.damageCap,
    Math.max(
      attackModifiers.minimumDamage,
      Math.max(
        0,
        Math.max(0, attackTotal - defenseTotal)
          + attackModifiers.bonusDamage
          - defenseModifiers.damageReduction,
      ),
    ),
  );

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

  const attackerName = combatantName(state, battle, attackerSide);
  const defenderName = combatantName(state, battle, defenderSide);
  const defenderHpBefore = sideHp(battle, defenderSide);
  const defenderDefeated = dealBattleDamage(
    state,
    battle,
    attackerSide,
    defenderSide,
    damage,
    (dealt) =>
      `${attackerName} 攻击 ${attackTotal} 对 防御 ${defenseTotal}，${defenderName}受到 ${dealt} 点伤害。`,
  );
  if (defenderDefeated) {
    finishBattle(state, battle, attackerSide);
    return { finished: true, extraAttacks: 0 };
  }
  const damageDealt = Math.max(0, defenderHpBefore - sideHp(battle, defenderSide));
  if (applyEnemyAfterAttack(state, battle, attackerSide, defenderSide, damageDealt)) {
    finishBattle(state, battle, defenderSide);
    return { finished: true, extraAttacks: 0 };
  }
  return { finished: false, extraAttacks: Math.max(0, attackModifiers.extraAttacks) };
}

/**
 * 一个攻击回合最多结算几次攻击。
 *
 * 追加出来的攻击会重新过一遍 beforeRoll，所以一条写错条件的能力可以每次都再追加
 * 一次，把回合卡死在这里。这个上限不是规则的一部分，只是不让引擎有机会不返回的
 * 护栏——真要打更多次时，改这个常数比赌内容侧永远写对要稳。
 */
const MAX_ATTACKS_PER_ROUND = 4;

export function resolveBattleRound(state: GameState) {
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
  /*
    计数排在效果结算之前，所以本回合打出的牌对本回合就已经算数了。

    反过来（先结算再计数）会让「对手每用一张卷轴，攻击 +1」这类效果慢半拍：
    玩家在被攻击的回合打防御牌，怪物要到下一回合才变强，牌面写的因果就断了。
  */
  countScrollUse(battle, attackerSide, attackScrollKinds.length);
  const attackBaseline = newRollModifiers();
  const attackDieSidesPenalty = takeNextAttackDieSidesPenalty(battle, attackerSide);
  if (attackDieSidesPenalty > 0) {
    attackBaseline.dieSidesBonus -= attackDieSidesPenalty;
    battle.log.unshift(
      `${combatantName(state, battle, attackerSide)}受到寒霜钉干扰，本次攻击骰上限 -${attackDieSidesPenalty}。`,
    );
    battle.log = battle.log.slice(0, 8);
  }
  const attackRollPenalty = takeNextAttackRollPenalty(battle, attackerSide);
  if (attackRollPenalty > 0) {
    attackBaseline.flatBonus -= attackRollPenalty;
    battle.log.unshift(
      `${combatantName(state, battle, attackerSide)}受到诱敌号角干扰，本次攻击骰结果 -${attackRollPenalty}。`,
    );
    battle.log = battle.log.slice(0, 8);
  }
  const attackEffectWinner = applyScrollEffects(
    state,
    battle,
    attackerSide,
    defenderSide,
    attackScrollKinds,
    attackBaseline,
  );
  if (attackEffectWinner) {
    finishBattle(state, battle, attackEffectWinner);
    return;
  }
  /*
    「使用道具后……」这类代价排在效果结算**之后**，和地图上那条路径对齐
    （engine.ts 的 useMapScroll）。反过来的话，残血时打疗牌会因为扣血下限
    白嫖掉代价——恰恰是它最该疼的时候。牌已经把对手打倒时上面已经 return，
    代价自然不再发生：赢下来的这一场没有"之后"。

    自己被代价扣倒时本回合就此中止，对面选好的牌还留在手里，
    和"卷轴直接把对手打倒"那条路径一致。
  */
  if (applyEquipmentScrollUse(state, battle, attackerSide, attackScrollKinds)) {
    finishBattle(state, battle, defenderSide);
    return;
  }

  const defenseScrollKinds = defenderId
    ? consumeScrolls(state, state.players[defenderId], defenseScrollIds)
    : [];
  countScrollUse(battle, defenderSide, defenseScrollKinds.length);
  const defenseBaseline = newRollModifiers();
  const defenseEffectWinner = applyScrollEffects(
    state,
    battle,
    defenderSide,
    attackerSide,
    defenseScrollKinds,
    defenseBaseline,
  );
  if (defenseEffectWinner) {
    finishBattle(state, battle, defenseEffectWinner);
    return;
  }
  if (applyEquipmentScrollUse(state, battle, defenderSide, defenseScrollKinds)) {
    finishBattle(state, battle, attackerSide);
    return;
  }
  /*
    卷轴结算完的这两份就是本回合的基线，之后每次攻击各复制一份去用。

    追加攻击（RollModifiers.extraAttacks）只让「投骰到扣血」这一段重来，
    卷轴不重打：牌已经离手，而它的作用范围本来就是整个攻击回合。
  */
  let pendingAttacks = 1;
  for (let settled = 0; pendingAttacks > 0 && settled < MAX_ATTACKS_PER_ROUND; settled += 1) {
    const outcome = resolveAttackSettlement(
      state,
      battle,
      attackerSide,
      defenderSide,
      attackBaseline,
      defenseBaseline,
    );
    if (outcome.finished) return;
    pendingAttacks += outcome.extraAttacks - 1;
  }

  const attackerCostDefeated = attackBaseline.postRoundSelfHpLoss > 0
    && applyBattleHpLoss(
      state,
      battle,
      attackerSide,
      attackBaseline.postRoundSelfHpLoss,
      `${combatantName(state, battle, attackerSide)}为极限突破支付代价，损失 ${attackBaseline.postRoundSelfHpLoss} 点生命。`,
    );
  const defenderCostDefeated = defenseBaseline.postRoundSelfHpLoss > 0
    && applyBattleHpLoss(
      state,
      battle,
      defenderSide,
      defenseBaseline.postRoundSelfHpLoss,
      `${combatantName(state, battle, defenderSide)}为极限突破支付代价，损失 ${defenseBaseline.postRoundSelfHpLoss} 点生命。`,
    );
  if (attackerCostDefeated || defenderCostDefeated) {
    // 双方同时被代价拖倒时，主动使用爆发的一侧承担风险，当前防守方获胜。
    finishBattle(
      state,
      battle,
      attackerCostDefeated ? defenderSide : attackerSide,
    );
    return;
  }

  const previousRound = battle.round;
  let nextAttacker: CombatSide = defenderSide;
  let nextRound = previousRound + 1;
  if (takeSkipNextAttack(battle, nextAttacker)) {
    battle.log.unshift(
      `${combatantName(state, battle, nextAttacker)}受最后壁垒影响，跳过下一次主动攻击。`,
    );
    battle.log = battle.log.slice(0, 8);
    nextAttacker = oppositeSide(nextAttacker);
    nextRound += 1;
  }
  battle.attacker = nextAttacker;
  battle.round = nextRound;
  resetChoices(battle);
  emit(state, {
    type: "battleRoundAdvanced",
    round: battle.round,
    attacker: nextAttacker,
    fromRound: previousRound,
    fromAttacker: attackerSide,
  });
  state.message = {
    text: `战斗第 ${battle.round} 轮：轮到${combatantName(state, battle, nextAttacker)}攻击。`,
  };
}

/**
 * 提交一侧的卷轴选择（GameRule 8.3）。
 *
 * 暗牌之下攻防双方在各自设备上独立决定，因此这里只记录选择；
 * 两侧都提交后才真正结算本回合。
 */
export function submitScrollChoice(
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
      playableScrolls(state.players[playerId], timing, battle)
        .map((scroll) => scroll.instanceId),
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
