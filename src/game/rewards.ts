import { EQUIPMENT, equipmentCategory } from "./content/equipment";
import { salvageEquipment } from "./economy";
import { applyStatGrowth, STAT_GROWTH } from "./growth";
import { regionForPosition } from "./map";
import {
  applyEquipmentStats,
  grantEquipment,
  removeEquipmentStats,
} from "./resources";
import { addHistory, emit } from "./state";
import type {
  ActionResult,
  EquipmentChoiceState,
  GameState,
  Player,
  StatGrowthOption,
} from "./types";

/**
 * 奖励到手之后那一串要玩家点确认的阶段：装备槽满的取舍、奖励弹层、首领加点。
 *
 * 收在一处是因为它们串成了一条链——装备选择完了回到弹层，弹层确认完了可能还要
 * 加点，而每一环都可能是链条的最后一环。链路的下一步由 EquipmentChoiceState.resume
 * 描述，只有这里解释它；散在各处的话，「装备槽满时首领奖励会不会丢」这种问题
 * 就要靠通读全文件来回答。
 *
 * 唯一交不回来的一步是「回到那一格继续结算」，它作为 ActionResult 交给 engine。
 */

export function grantTreasureEquipmentReward(
  state: GameState,
  player: Player,
  remaining: number,
) {
  if (remaining <= 0) {
    state.phase = { kind: "turnComplete" };
    return;
  }
  const reward = grantEquipment(
    state,
    player,
    undefined,
    remaining > 1
      ? { kind: "grantTreasureEquipment", remaining: remaining - 1 }
      : { kind: "turnComplete" },
  );
  if (!reward.pendingEquipmentChoice) {
    if (remaining > 1) grantTreasureEquipmentReward(state, player, remaining - 1);
    else state.phase = { kind: "turnComplete" };
  }
  addHistory(state, `${player.name}因宝物猎人额外获得${reward.name}。`);
}

function resumeAfterEquipmentChoice(
  state: GameState,
  playerId: Player["id"],
  resume: EquipmentChoiceState["resume"],
): ActionResult {
  switch (resume.kind) {
    case "turnComplete":
      state.phase = { kind: "turnComplete" };
      return true;
    case "resolveTile":
      return { resolveTile: resume.tileIndex };
    case "grantTreasureEquipment":
      grantTreasureEquipmentReward(state, state.players[playerId], resume.remaining);
      return true;
    case "showPveReward":
      state.phase = { kind: "pveReward", notice: resume.notice };
      return true;
  }
}

/** 装备槽满时，由获得装备的玩家选择替换同类装备，或放弃新装备。 */
export function chooseEquipment(
  state: GameState,
  replaceInstanceId?: string,
): ActionResult {
  if (state.phase.kind !== "equipmentChoice") return false;
  const choice = state.phase.choice;
  const player = state.players[choice.playerId];
  const offered = choice.offered;
  const offeredDefinition = EQUIPMENT[offered.kind];

  if (!replaceInstanceId) {
    const salvaged = salvageEquipment(state, player, offered.kind);
    addHistory(
      state,
      `${player.name}放弃了${offeredDefinition.name}，折算为 ${salvaged} 金币。`,
    );
    return resumeAfterEquipmentChoice(state, choice.playerId, choice.resume);
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
  // 折算放在装上新装备之后：换下来的旧件此时才真正离场，事件顺序也和玩家看到的一致
  const salvaged = salvageEquipment(state, player, removed.kind);
  addHistory(
    state,
    `${player.name}用${offeredDefinition.name}替换了${EQUIPMENT[removed.kind].name}，`
      + `旧装备折算为 ${salvaged} 金币。`,
  );
  return resumeAfterEquipmentChoice(state, choice.playerId, choice.resume);
}

export function acknowledgePveReward(state: GameState) {
  if (state.phase.kind !== "pveReward") return false;
  const notice = state.phase.notice;
  if (!notice.statGrowth) {
    state.phase = { kind: "turnComplete" };
    return true;
  }
  const stageId = regionForPosition(state.map, state.players[notice.playerId].position).id;
  state.phase = {
    kind: "statGrowthChoice",
    choice: { playerId: notice.playerId, stageId },
  };
  return true;
}

/** 击败阶段首领后的三选一加点。 */
export function chooseStatGrowth(state: GameState, option: StatGrowthOption) {
  if (state.phase.kind !== "statGrowthChoice") return false;
  const player = state.players[state.phase.choice.playerId];
  if (!player) return false;
  applyStatGrowth(state, player, option);
  state.phase = { kind: "turnComplete" };
  addHistory(state, `${player.name}选择了${STAT_GROWTH[option].name}。`);
  return true;
}
