import { SCROLLS } from "./content/scrolls";
import {
  applyBattleHealing,
  applyBattleHpLoss,
  applyDirectScrollDamage,
  battlePlayerForSide,
  choiceFor,
  chosenInstanceIds,
  combatantName,
  dealBattleDamage,
  finishBattle,
  forEachEquipmentEffects,
  resetChoices,
  setChoice,
  sideHp,
  sideMaxHp,
  sideStats,
} from "./battle";
import { consumeScrolls } from "./resources";
import { applyBlessingCombatRoll } from "./blessings";
import {
  enemyDiceCountBonus,
  enemyDieSidesBonus,
  enemyEffects,
  getDiceCountBonus,
  getDieSidesBonus,
  playableScrolls,
} from "./selectors";
import { emit, rollDie } from "./state";
import type {
  BattleHookContext,
  EnemyEffects,
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
    extraDice: 0,
    rollAttempts: 1,
    minimumRoll: 1,
    maxRollDice: 0,
    fixedRollDice: 0,
    fixedRollValue: 0,
    bonusDamage: 0,
    damageReduction: 0,
  };
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
      return false;
    case "dieSides":
      /*
        取最大而不是后写覆盖。

        一回合可以打任意多张牌，两张换骰面的卷轴同时打出时，"谁生效"不能取决于
        提交顺序——那种依赖不会报错，只会让数值悄悄算错。取最大之后顺序在数学上
        就影响不了结果，也就不需要给每张卡维护优先级。
        rollModifiers.test.ts 有一条排列测试守着这个性质。
      */
      modifiers.sidesOverride = Math.max(modifiers.sidesOverride ?? 0, effect.sides);
      return false;
    case "extraDice":
      modifiers.extraDice += effect.count;
      return false;
    case "rollTwice":
      modifiers.rollAttempts = Math.max(modifiers.rollAttempts, 2);
      return false;
    case "minimumRoll":
      modifiers.minimumRoll = Math.max(modifiers.minimumRoll, effect.value);
      return false;
    case "maxRoll":
      modifiers.maxRollDice += effect.count;
      return false;
    case "fixedRoll":
      modifiers.fixedRollDice += effect.count;
      // 颗数累加、点数取最大，理由同上面的 dieSides：一回合可以打任意多张牌，
      // 两张钉点数的卷轴撞在一起时，"谁生效"不能取决于提交顺序
      modifiers.fixedRollValue = Math.max(modifiers.fixedRollValue, effect.value);
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
    case "damageReduction":
      modifiers.damageReduction += Math.max(0, effect.amount);
      return false;
    case "heal":
      applyBattleHealing(state, battle, sourceSide, effect.amount, effectName);
      return false;
    case "forfeitMovement": {
      const playerId = battlePlayerForSide(battle, sourceSide);
      if (playerId) state.players[playerId].skipNextMovement = true;
      battle.log.unshift(
        `${combatantName(state, battle, sourceSide)}将在下一次地图行动中无法移动。`,
      );
      battle.log = battle.log.slice(0, 8);
      return false;
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
      return targetDefeated || result?.targetDefeated === true;
    }
  }
}

/**
 * 依次结算本侧本回合打出的全部卷轴，返回目标是否已被打倒。
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
  }
  return false;
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
  const sides = Math.max(2, (modifiers.sidesOverride ?? 6) + sidesBonus);
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
      () => rollDie(state, sides),
    );
    const roll = Math.min(
      sides,
      Math.max(modifiers.minimumRoll, ...attempts),
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

/** 装备与怪物共用的那半份上下文。 */
export function battleHookContext(
  state: GameState,
  battle: BattleState,
  side: CombatSide,
  opponentSide: CombatSide,
  dieKind: "attack" | "defense",
  modifiers: RollModifiers,
): BattleHookContext {
  return {
    state,
    battle,
    side,
    opponentSide,
    dieKind,
    modifiers,
    ownHp: sideHp(battle, side),
    ownMaxHp: sideMaxHp(state, battle, side),
    opponentHp: sideHp(battle, opponentSide),
    opponentMaxHp: sideMaxHp(state, battle, opponentSide),
    addBattleLog(text) {
      battle.log.unshift(text);
      battle.log = battle.log.slice(0, 8);
    },
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
  forEachEnemyEffects(battle, side, (effects) => {
    effects.beforeRoll?.(
      battleHookContext(state, battle, side, opponentSide, dieKind, modifiers),
    );
  });
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
  const attackModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    attackerSide,
    defenderSide,
    attackScrollKinds,
    attackModifiers,
  )) {
    finishBattle(state, battle, attackerSide);
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
  const defenseModifiers = newRollModifiers();
  if (applyScrollEffects(
    state,
    battle,
    defenderSide,
    attackerSide,
    defenseScrollKinds,
    defenseModifiers,
  )) {
    finishBattle(state, battle, defenderSide);
    return;
  }
  if (applyEquipmentScrollUse(state, battle, defenderSide, defenseScrollKinds)) {
    finishBattle(state, battle, attackerSide);
    return;
  }
  applyEquipmentBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  );
  applyEquipmentBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  );
  applyEnemyBeforeRoll(
    state, battle, attackerSide, defenderSide, "attack", attackModifiers,
  );
  applyEnemyBeforeRoll(
    state, battle, defenderSide, attackerSide, "defense", defenseModifiers,
  );
  if (attackerId) applyBlessingCombatRoll(state.players[attackerId], attackModifiers);
  if (defenderId) applyBlessingCombatRoll(state.players[defenderId], defenseModifiers);

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

  const attackBase = sideStats(state, battle, attackerSide).attack;
  const defenseBase = sideStats(state, battle, defenderSide).defense;
  const attackBonus = attackModifiers.flatBonus;
  const defenseBonus = defenseModifiers.flatBonus;
  const attackTotal = attackBase + attackRoll.sum + attackBonus;
  const defenseTotal = defenseBase + defenseRoll.sum + defenseBonus;
  // bonusDamage 不吃防御值，但仍属于本次最终伤害，可以被闪避类效果减免
  const damage = Math.max(
    0,
    Math.max(0, attackTotal - defenseTotal)
      + attackModifiers.bonusDamage
      - defenseModifiers.damageReduction,
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
    return;
  }

  const previousRound = battle.round;
  battle.attacker = defenderSide;
  battle.round += 1;
  resetChoices(battle);
  emit(state, {
    type: "battleRoundAdvanced",
    round: battle.round,
    attacker: defenderSide,
    fromRound: previousRound,
    fromAttacker: attackerSide,
  });
  state.message = { text: `战斗第 ${battle.round} 轮：轮到${defenderName}攻击。` };
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
      playableScrolls(state.players[playerId], timing).map((scroll) => scroll.instanceId),
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
