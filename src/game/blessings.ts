import {
  blessingDefinition,
  pickBlessingKind,
} from "./content/blessings";
import { emit, makeInstanceId, nextRandom } from "./state";
import type { BlessingKind } from "./content/blessings";
import type { GameState, OwnedBlessing, Player } from "./types";
import type { RollModifiers } from "./effects/battleHooks";

function effects(player: Player) {
  const blessing = player.blessings[0];
  return blessing ? blessingDefinition(blessing.kind).effects ?? [] : [];
}

export function applyBlessingCombatRoll(player: Player, modifiers: RollModifiers) {
  for (const effect of effects(player)) {
    if (effect.type === "minimumCombatRoll") {
      modifiers.minimumRoll = Math.max(modifiers.minimumRoll, effect.value);
    }
  }
}

export function blessingMovementRollBonus(player: Player) {
  return effects(player).reduce(
    (sum, effect) => sum + (effect.type === "movementRollBonus" ? effect.value : 0),
    0,
  );
}

export function bonusPveVictoryScrolls(player: Player) {
  return effects(player).reduce(
    (sum, effect) => sum + (effect.type === "extraPveVictoryScroll" ? effect.count : 0),
    0,
  );
}

export function bonusTreasureEquipment(player: Player) {
  return effects(player).reduce(
    (sum, effect) => sum + (effect.type === "extraTreasureEquipment" ? effect.count : 0),
    0,
  );
}

/** 返回是否以不屈意志替代了本次 PvP 惩罚，并在真实生命账本上支付代价。 */
export function applyPvpPenaltyReplacement(state: GameState, player: Player) {
  const amount = effects(player).reduce(
    (sum, effect) => sum + (
      effect.type === "replacePvpPenaltyWithHpLoss" ? effect.amount : 0
    ),
    0,
  );
  if (amount <= 0) return false;
  const hpBefore = player.hp;
  player.hp = Math.max(1, player.hp - amount);
  if (player.hp !== hpBefore) {
    emit(state, {
      type: "playerHpChanged",
      playerId: player.id,
      from: hpBefore,
      to: player.hp,
      maxHp: player.maxHp,
      reason: "blessing",
    });
  }
  return true;
}

function maxHpBonus(blessing: OwnedBlessing) {
  return blessingDefinition(blessing.kind).modifiers
    .filter((modifier) => modifier.type === "maxHp")
    .reduce((sum, modifier) => sum + modifier.value, 0);
}

function applyBlessing(state: GameState, player: Player, blessing: OwnedBlessing) {
  player.blessings.push(blessing);
  const bonus = maxHpBonus(blessing);
  if (bonus === 0) return;
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp += bonus;
  player.hp = Math.min(player.maxHp, player.hp + bonus);
  emit(state, { type: "maxHpChanged", playerId: player.id, from: maxHpBefore, to: player.maxHp });
  if (player.hp !== hpBefore) {
    emit(state, {
      type: "playerHpChanged",
      playerId: player.id,
      from: hpBefore,
      to: player.hp,
      maxHp: player.maxHp,
      reason: "blessing",
    });
  }
}

function removeBlessing(state: GameState, player: Player, blessing: OwnedBlessing) {
  const bonus = maxHpBonus(blessing);
  if (bonus === 0) return;
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp -= bonus;
  player.hp = Math.min(player.hp, player.maxHp);
  emit(state, { type: "maxHpChanged", playerId: player.id, from: maxHpBefore, to: player.maxHp });
  if (player.hp !== hpBefore) {
    emit(state, {
      type: "playerHpChanged",
      playerId: player.id,
      from: hpBefore,
      to: player.hp,
      maxHp: player.maxHp,
      reason: "blessing",
    });
  }
}

/** 只抽取并创建赐福实例，不立即应用；用于已有赐福时先展示替换选择。 */
export function drawRandomBlessing(
  state: GameState,
  excluded: readonly BlessingKind[] = [],
): OwnedBlessing | undefined {
  const kind = pickBlessingKind(() => nextRandom(state), excluded);
  if (kind === undefined) return undefined;
  return {
    instanceId: makeInstanceId(state, "blessing"),
    kind,
  };
}

/** 接纳一个已抽出的新赐福，并发出公开获得事件。 */
export function acceptDrawnBlessing(
  state: GameState,
  player: Player,
  blessing: OwnedBlessing,
) {
  if (player.blessings.length > 0) return false;
  applyBlessing(state, player, blessing);
  emit(state, {
    type: "blessingGranted",
    playerId: player.id,
    instanceId: blessing.instanceId,
    kind: blessing.kind,
  });
  return true;
}

/** 随机授予一个赐福；内容池尚未配置时返回 undefined。 */
export function grantRandomBlessing(
  state: GameState,
  player: Player,
): OwnedBlessing | undefined {
  if (player.blessings.length > 0) return undefined;
  const blessing = drawRandomBlessing(state);
  if (!blessing || !acceptDrawnBlessing(state, player, blessing)) return undefined;
  return blessing;
}

/** 从玩家身上取下唯一赐福，并立即撤销其属性。 */
export function detachBlessing(
  state: GameState,
  player: Player,
): OwnedBlessing | undefined {
  const blessing = player.blessings.shift();
  if (!blessing) return undefined;
  removeBlessing(state, player, blessing);
  return blessing;
}

/** 把已经取下的赐福交给没有赐福的赢家。 */
export function receiveTransferredBlessing(
  state: GameState,
  winner: Player,
  loserId: Player["id"],
  blessing: OwnedBlessing,
) {
  if (winner.blessings.length > 0) return false;
  applyBlessing(state, winner, blessing);
  emit(state, {
    type: "blessingTransferred",
    fromId: loserId,
    toId: winner.id,
    instanceId: blessing.instanceId,
    kind: blessing.kind,
  });
  return true;
}

export function blessingName(blessing: OwnedBlessing) {
  return blessingDefinition(blessing.kind).name;
}
