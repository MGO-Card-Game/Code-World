import {
  HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS,
  pickEquipmentKind,
} from "./content/equipment";
import {
  mapEventDefinition,
  pickMapEvent,
  type MapEventEffectDefinition,
} from "./content/events";
import {
  grantEquipment,
  grantMapEventResource,
  rewardSecret,
} from "./resources";
import { addHistory, emit, nextRandom } from "./state";
import { grantGold } from "./economy";
import type { GameState, MapTile, Player } from "./types";

/**
 * 事件格的结算。
 *
 * 事件效果是声明式配置（见 content/events），这里只负责把每一种效果词汇翻译成
 * 对状态的改动、结构化事件和旁白。新增事件应该是改配置，不是改这个文件。
 */

/**
 * 结算一条声明式地图事件效果；返回 true 表示装备槽选择暂停了后续即时效果。
 */
export function applyMapEventEffect(
  state: GameState,
  player: Player,
  effect: MapEventEffectDefinition,
) {
  switch (effect.type) {
    case "heal": {
      const hpBefore = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + Math.max(0, effect.amount));
      const amount = player.hp - hpBefore;
      if (amount > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "event",
        });
      }
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "damage": {
      const hpBefore = player.hp;
      const minimumHp = Math.max(0, Math.min(player.hp, effect.minimumHp ?? 1));
      player.hp = Math.max(minimumHp, player.hp - Math.max(0, effect.amount));
      const amount = hpBefore - player.hp;
      if (amount > 0) {
        emit(state, {
          type: "playerHpChanged",
          playerId: player.id,
          from: hpBefore,
          to: player.hp,
          maxHp: player.maxHp,
          reason: "event",
        });
      }
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "grantResource": {
      const reward = grantMapEventResource(state, player, effect.resource);
      const line = (rewardName: string) => effect.narration({
        playerName: player.name,
        rewardName,
      });
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return reward.pendingEquipmentChoice === true;
    }
    case "increaseBaseStat": {
      const key = effect.stat === "attack" ? "baseAttack" : "baseDefense";
      const from = player[key];
      player[key] += Math.max(0, effect.amount);
      const amount = player[key] - from;
      if (amount > 0) {
        emit(state, {
          type: "baseStatChanged",
          playerId: player.id,
          stat: effect.stat,
          from,
          to: player[key],
        });
      }
      addHistory(state, effect.narration({
        playerName: player.name,
        stat: effect.stat,
        amount,
      }));
      return false;
    }
    case "grantGold": {
      const amount = grantGold(state, player, effect.amount, "event");
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "grantEquipment": {
      const kind = pickEquipmentKind(
        () => nextRandom(state),
        {
          category: effect.category,
          rarityWeights: effect.quality === "high"
            ? HIGH_QUALITY_EQUIPMENT_RARITY_WEIGHTS
            : undefined,
        },
      );
      const reward = grantEquipment(state, player, kind);
      const line = (rewardName: string) => effect.narration({
        playerName: player.name,
        rewardName,
      });
      addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      return reward.pendingEquipmentChoice === true;
    }
    case "enterCasino": {
      state.phase = {
        kind: "casino",
        casino: { playerId: player.id, tileIndex: player.position, spins: 0 },
      };
      addHistory(state, effect.narration({ playerName: player.name }));
      return true;
    }
  }
}

export function resolveRandomMapEvent(state: GameState, player: Player, region: MapTile["region"]) {
  const kind = pickMapEvent(region, () => nextRandom(state));
  const definition = mapEventDefinition(kind);
  state.phase = { kind: "turnComplete" };
  for (const effect of definition.effects) {
    if (applyMapEventEffect(state, player, effect)) break;
  }
}
