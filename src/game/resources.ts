import {
  EQUIPMENT,
  EQUIPMENT_SLOT_LIMITS,
  equipmentCategory,
  equipmentDefinition,
  pickEquipmentKind,
} from "./content/equipment";
import { pickScrollKind, SCROLLS } from "./content/scrolls";
import { emit, makeInstanceId, nextRandom, rollDie } from "./state";
import type {
  EquipmentKind,
  GameState,
  OwnedEquipment,
  OwnedScroll,
  Player,
  ScrollKind,
} from "./types";
import type { MapEventResource } from "./content/events";

/**
 * 卷轴与装备的增、减、槽位。
 *
 * 抽出来的判据是「谁在动玩家背包」：宝箱、事件、战斗奖励、相遇战代价、装备替换
 * 全都要动它，而这些调用方彼此毫无关系。放在一处之后，暗牌旁白（rewardSecret）
 * 和生命上限联动（applyEquipmentStats）这两件容易漏的事就只有一个实现点。
 */

/**
 * 一次奖励的两种说法。
 *
 * 卷轴是暗牌，旁观者只该知道「获得了一张卷轴」；装备是公开的，两者相同。
 * 让奖励自己带上这两种说法，而不是让调用方去猜这次给的是不是卷轴。
 */
export interface Reward {
  name: string;
  publicName: string;
  pendingEquipmentChoice?: boolean;
}

export function grantScroll(state: GameState, player: Player, kind?: ScrollKind): Reward {
  const selected = kind ?? pickScrollKind(() => nextRandom(state));
  const scroll: OwnedScroll = {
    instanceId: makeInstanceId(state, "scroll"),
    kind: selected,
  };
  player.scrolls.push(scroll);
  emit(state, {
    type: "scrollGranted",
    playerId: player.id,
    instanceId: scroll.instanceId,
    kind: selected,
  });
  return {
    name: SCROLLS[selected].name,
    publicName: "一张卷轴",
  };
}

/** 宝箱与非 Boss 战斗共用的资源奖励：卷轴、装备各 50%。 */
export function grantRandomResourceReward(state: GameState, player: Player): Reward {
  return rollDie(state, 2) === 1
    ? grantScroll(state, player)
    : grantEquipment(state, player);
}

/** 按奖励是否需要保密，拼出 addHistory 的第三个参数 */
export function rewardSecret(player: Player, template: (what: string) => string, reward: Reward) {
  if (reward.name === reward.publicName) return undefined;
  return { owner: player.id, publicText: template(reward.publicName) };
}

function equipmentMaxHp(item: OwnedEquipment) {
  return EQUIPMENT[item.kind].modifiers
    .filter((effect) => effect.type === "maxHp")
    .reduce((sum, effect) => sum + effect.value, 0);
}

function runEquipmentHook(
  hook: "onEquip" | "onUnequip",
  state: GameState,
  player: Player,
  item: OwnedEquipment,
) {
  equipmentDefinition(item.kind).effects?.[hook]?.({ state, player, item });
}

/** 只负责装备入槽和属性联动；调用方决定发哪一种获得/转移事件。 */
export function applyEquipmentStats(
  state: GameState,
  player: Player,
  item: OwnedEquipment,
) {
  player.equipment.push(item);
  const maxHpBonus = equipmentMaxHp(item);
  runEquipmentHook("onEquip", state, player, item);
  if (maxHpBonus === 0) return;
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp += maxHpBonus;
  player.hp = Math.min(player.maxHp, player.hp + maxHpBonus);
  emit(state, {
    type: "maxHpChanged",
    playerId: player.id,
    from: maxHpBefore,
    to: player.maxHp,
  });
  emit(state, {
    type: "playerHpChanged",
    playerId: player.id,
    from: hpBefore,
    to: player.hp,
    maxHp: player.maxHp,
    reason: "equipment",
  });
}

export function removeEquipmentStats(
  state: GameState,
  player: Player,
  instanceId: string,
) {
  const index = player.equipment.findIndex((item) => item.instanceId === instanceId);
  if (index < 0) return undefined;
  const [item] = player.equipment.splice(index, 1);
  const maxHpBonus = equipmentMaxHp(item);
  runEquipmentHook("onUnequip", state, player, item);
  if (maxHpBonus !== 0) {
    const maxHpBefore = player.maxHp;
    const hpBefore = player.hp;
    player.maxHp -= maxHpBonus;
    player.hp = Math.min(player.hp, player.maxHp);
    emit(state, {
      type: "maxHpChanged",
      playerId: player.id,
      from: maxHpBefore,
      to: player.maxHp,
    });
    if (player.hp !== hpBefore) {
      emit(state, {
        type: "playerHpChanged",
        playerId: player.id,
        from: hpBefore,
        to: player.hp,
        maxHp: player.maxHp,
        reason: "equipment",
      });
    }
  }
  return item;
}

export function equipmentInCategory(player: Player, kind: EquipmentKind) {
  const category = equipmentCategory(kind);
  return player.equipment.filter((item) => equipmentCategory(item.kind) === category);
}

export function hasFreeEquipmentSlot(player: Player, kind: EquipmentKind) {
  const category = equipmentCategory(kind);
  return equipmentInCategory(player, kind).length < EQUIPMENT_SLOT_LIMITS[category];
}

export function grantEquipment(
  state: GameState,
  player: Player,
  selectedKind?: EquipmentKind,
): Reward {
  const kind = selectedKind ?? pickEquipmentKind(() => nextRandom(state));
  const item: OwnedEquipment = {
    instanceId: makeInstanceId(state, "equipment"),
    kind,
  };
  const name = EQUIPMENT[kind].name;
  if (!hasFreeEquipmentSlot(player, kind)) {
    state.phase = {
      kind: "equipmentChoice",
      choice: {
        playerId: player.id,
        offered: item,
        source: "reward",
        resume: { kind: "turnComplete" },
      },
    };
    return { name, publicName: name, pendingEquipmentChoice: true };
  }
  emit(state, {
    type: "equipmentGranted",
    playerId: player.id,
    instanceId: item.instanceId,
    kind,
  });
  applyEquipmentStats(state, player, item);
  return { name, publicName: name };
}

export function grantMapEventResource(
  state: GameState,
  player: Player,
  resource: MapEventResource,
) {
  switch (resource) {
    case "scroll":
      return grantScroll(state, player);
    case "equipment":
      return grantEquipment(state, player);
    case "random":
      return grantRandomResourceReward(state, player);
  }
}

export function consumeScroll(
  state: GameState,
  player: Player,
  instanceId: string | undefined,
) {
  if (!instanceId) return undefined;
  const index = player.scrolls.findIndex((scroll) => scroll.instanceId === instanceId);
  if (index < 0) return undefined;
  const [scroll] = player.scrolls.splice(index, 1);
  emit(state, {
    type: "scrollConsumed",
    playerId: player.id,
    instanceId,
    kind: scroll.kind,
  });
  return scroll.kind;
}

/**
 * 消耗本回合提交的全部卷轴。
 *
 * 刻意先把牌全部消耗掉，再去结算效果：中途有一张把对手打倒时，
 * 剩下的牌也已经打出去了，不该因为对面先死就退回手里。
 */
export function consumeScrolls(
  state: GameState,
  player: Player,
  instanceIds: readonly string[],
): ScrollKind[] {
  const kinds: ScrollKind[] = [];
  for (const instanceId of instanceIds) {
    const kind = consumeScroll(state, player, instanceId);
    if (kind) kinds.push(kind);
  }
  return kinds;
}
