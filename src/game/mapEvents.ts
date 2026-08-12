import { EQUIPMENT, pickEquipmentKind } from "./content/equipment";
import { DEFAULT_RARITY_TIER, REWARD_RARITY_TIERS } from "./content/rarity";
import {
  mapEventDefinition,
  pickMapEvent,
  type MapEventKind,
  type MapEventAmount,
  type MapEventEffectDefinition,
} from "./content/events";
import {
  grantEquipment,
  grantMapEventResource,
  grantScroll,
  removeEquipmentStats,
  rewardSecret,
} from "./resources";
import { addHistory, emit, nextRandom, rollDie } from "./state";
import { grantGold, spendGold } from "./economy";
import type { GamePhase, GameState, LogEntry, MapTile, Player } from "./types";

/**
 * 事件格的结算。
 *
 * 事件效果是声明式配置（见 content/events），这里只负责把每一种效果词汇翻译成
 * 对状态的改动、结构化事件和旁白。新增事件应该是改配置，不是改这个文件。
 */

/**
 * 把配置里的数值折算成本次结算的具体点数。
 *
 * 固定数值一个随机数都不消耗，掷骰数值严格消耗 dice 个——随机流的消耗量只取决于
 * 配置形状，不取决于运行时状态，同种子重放才不会在这里错位。
 */
function resolveAmount(state: GameState, amount: MapEventAmount) {
  if (typeof amount === "number") return { value: amount, roll: undefined };
  let roll = 0;
  for (let die = 0; die < amount.dice; die += 1) roll += rollDie(state, amount.sides);
  return { value: roll * (amount.multiplier ?? 1), roll };
}

/**
 * 结算一条声明式地图事件效果；返回 true 表示效果自己接管了阶段，
 * 后续效果不再结算。
 */
export function applyMapEventEffect(
  state: GameState,
  player: Player,
  effect: MapEventEffectDefinition,
  source?: { eventKind: MapEventKind; effectIndex: number },
) {
  switch (effect.type) {
    case "heal": {
      const { value, roll } = resolveAmount(state, effect.amount);
      const hpBefore = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + Math.max(0, value));
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
      addHistory(state, effect.narration({ playerName: player.name, amount, roll }));
      return false;
    }
    case "damage": {
      const { value, roll } = resolveAmount(state, effect.amount);
      const hpBefore = player.hp;
      const minimumHp = Math.max(0, Math.min(player.hp, effect.minimumHp ?? 1));
      player.hp = Math.max(minimumHp, player.hp - Math.max(0, value));
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
      addHistory(state, effect.narration({ playerName: player.name, amount, roll }));
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
    case "grantScroll": {
      // 每张牌各发一次、各写一条旁白：暗牌裁剪是按条生效的，合并成一句就得另外
      // 维护「两张卷轴」这类脱敏说法，而卷轴数量本身并不是需要保密的情报。
      const count = Math.max(1, Math.floor(effect.count ?? 1));
      for (let issued = 0; issued < count; issued += 1) {
        const reward = grantScroll(state, player, effect.kind);
        const line = (rewardName: string) => effect.narration({
          playerName: player.name,
          rewardName,
        });
        addHistory(state, line(reward.name), rewardSecret(player, line, reward));
      }
      return false;
    }
    case "skipNextMovement": {
      player.skipNextMovement = { reason: effect.reason };
      addHistory(state, effect.narration({ playerName: player.name }));
      return false;
    }
    case "adjustBaseStat": {
      const key = effect.stat === "attack" ? "baseAttack" : "baseDefense";
      const from = player[key];
      // 下限钉在 0：负的基础攻防在减法结算里等于每次交手白送伤害
      player[key] = Math.max(0, from + effect.amount);
      const amount = player[key] - from;
      if (amount !== 0) {
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
      const { value, roll } = resolveAmount(state, effect.amount);
      const amount = grantGold(state, player, value, "event");
      addHistory(state, effect.narration({ playerName: player.name, amount, roll }));
      return false;
    }
    case "loseGold": {
      // 按余额算出来的数额永远付得起，spendGold 只会在算出 0 时拒绝
      const charged = Math.floor(player.gold * Math.max(0, effect.percent) / 100);
      const amount = spendGold(state, player, charged, "event") ? charged : 0;
      addHistory(state, effect.narration({ playerName: player.name, amount }));
      return false;
    }
    case "takeScrollFromEachOpponent": {
      /*
        按 turnOrder 遍历，顺序固定——用 Object.values(state.players) 的话，
        收牌顺序会跟着对象键序走，同种子重放和联机双端未必一致。
        掉线的玩家照收：掉线不等于退出对局，他的牌还在场上。
      */
      let collected = 0;
      for (const donorId of state.turnOrder) {
        if (donorId === player.id) continue;
        const donor = state.players[donorId];
        if (donor.scrolls.length === 0) continue;
        collected += 1;
        const [item] = donor.scrolls.splice(rollDie(state, donor.scrolls.length) - 1, 1);
        player.scrolls.push(item);
        emit(state, {
          type: "scrollTransferred",
          fromId: donor.id,
          toId: player.id,
          instanceId: item.instanceId,
          kind: item.kind,
        });
        /*
          旁白不点名是哪一张，所以不需要 secret：这张牌交出方和接收方都知道，
          而 LogEntry.secret 只认一个 owner，表达不了「两个人可见」。
          相遇战代价那条转移旁白（pvpPenalty）出于同样的理由也只说"一件资源"。
          接收方想知道拿到了什么，看自己手牌就行。
        */
        addHistory(state, effect.narration({
          playerName: player.name,
          donorName: donor.name,
        }));
      }
      if (collected === 0) {
        addHistory(state, effect.emptyNarration({ playerName: player.name }));
      }
      return false;
    }
    case "duplicateOwnedScroll": {
      if (player.scrolls.length === 0) {
        addHistory(state, effect.emptyNarration({ playerName: player.name }));
        return false;
      }
      if (!source) throw new Error("复制卷轴事件缺少内容表来源");
      state.phase = {
        kind: "mapEventScrollChoice",
        choice: {
          playerId: player.id,
          candidateIds: player.scrolls.map((scroll) => scroll.instanceId),
          eventKind: source.eventKind,
          effectIndex: source.effectIndex,
        },
      };
      addHistory(state, effect.narration({ playerName: player.name }));
      return true;
    }
    case "exchangeEquipmentForDefense": {
      if (player.equipment.length === 0) {
        addHistory(state, effect.emptyNarration({ playerName: player.name }));
        return false;
      }
      if (!source) throw new Error("装备交换事件缺少内容表来源");
      state.phase = {
        kind: "mapEventEquipmentChoice",
        choice: {
          playerId: player.id,
          candidateIds: player.equipment.map((item) => item.instanceId),
          eventKind: source.eventKind,
          effectIndex: source.effectIndex,
        },
      };
      addHistory(state, effect.narration({ playerName: player.name }));
      return true;
    }
    case "grantEquipment": {
      const kind = pickEquipmentKind(
        () => nextRandom(state),
        {
          category: effect.category,
          rarityWeights: REWARD_RARITY_TIERS[effect.quality ?? DEFAULT_RARITY_TIER],
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

/**
 * 读一次当前阶段。
 *
 * 单独抽成函数是为了绕开 TS 的控制流窄化：上面刚给 state.phase 赋过字面量，
 * 分析就认定它一直是那个值，而中间的效果结算完全可能已经把阶段换掉了。
 */
function currentPhase(state: GameState): GamePhase {
  return state.phase;
}

/** 抽一个事件并结算，结果停在需要当事人确认的通知弹层上。 */
export function resolveRandomMapEvent(
  state: GameState,
  player: Player,
  region: MapTile["region"],
) {
  const kind = pickMapEvent(region, () => nextRandom(state));
  const definition = mapEventDefinition(kind);
  state.phase = { kind: "turnComplete" };
  /*
    旁白从事件流里回收，而不是从 state.history 里截。history 是倒序的、且只留最近
    12 条，长事件自己就能把开头挤掉；lastEvents 在一次 action 内顺序追加，截取
    区间才对得上"这个事件产生了哪几句"。
  */
  const from = state.lastEvents.length;
  for (const [effectIndex, effect] of definition.effects.entries()) {
    if (applyMapEventEffect(state, player, effect, { eventKind: kind, effectIndex })) break;
  }
  const lines: LogEntry[] = [];
  for (const event of state.lastEvents.slice(from)) {
    if (event.type !== "narration") continue;
    lines.push(event.secret ? { text: event.text, secret: event.secret } : { text: event.text });
  }
  // 效果可能已经把阶段切去赌场或装备取舍，先讲完事件，确认后再把它交还回去
  const taken = currentPhase(state);
  const resume = taken.kind === "casino"
    || taken.kind === "equipmentChoice"
    || taken.kind === "mapEventScrollChoice"
    || taken.kind === "mapEventEquipmentChoice"
    ? taken
    : undefined;
  /*
    掉线的人不会有人去读这块通知，直接把阶段交给它原本要去的地方。留着的话，整局会
    卡在一个没人关得掉的弹层上，而掉线兜底的每条分支都得多认一种阶段。
  */
  if (state.unavailablePlayerIds.includes(player.id)) {
    state.phase = resume ?? { kind: "turnComplete" };
    return;
  }
  state.phase = {
    kind: "mapEventNotice",
    notice: { playerId: player.id, kind, lines, resume },
  };
}

/** 关掉事件通知，把阶段交还给事件效果原本要去的地方。 */
export function acknowledgeMapEvent(state: GameState) {
  if (state.phase.kind !== "mapEventNotice") return false;
  state.phase = state.phase.notice.resume ?? { kind: "turnComplete" };
  return true;
}

/** 完成地图事件发起的卷轴复制选择。原牌保留，复制品走统一发牌事件与暗牌旁白。 */
export function chooseMapEventScroll(state: GameState, instanceId: string) {
  if (state.phase.kind !== "mapEventScrollChoice") return false;
  const { choice } = state.phase;
  if (!choice.candidateIds.includes(instanceId)) return false;
  const player = state.players[choice.playerId];
  const original = player.scrolls.find((scroll) => scroll.instanceId === instanceId);
  if (!original) return false;
  const effect = mapEventDefinition(choice.eventKind).effects[choice.effectIndex];
  if (effect?.type !== "duplicateOwnedScroll") return false;

  const reward = grantScroll(state, player, original.kind);
  const line = (rewardName: string) => effect.selectedNarration({
    playerName: player.name,
    rewardName,
  });
  addHistory(state, line(reward.name), rewardSecret(player, line, reward));
  state.phase = { kind: "turnComplete" };
  return true;
}

/** 接受或拒绝地图事件发起的装备交换。 */
export function chooseMapEventEquipment(state: GameState, instanceId?: string) {
  if (state.phase.kind !== "mapEventEquipmentChoice") return false;
  const { choice } = state.phase;
  const player = state.players[choice.playerId];
  const effect = mapEventDefinition(choice.eventKind).effects[choice.effectIndex];
  if (effect?.type !== "exchangeEquipmentForDefense") return false;

  if (!instanceId) {
    addHistory(state, effect.declinedNarration({ playerName: player.name }));
    state.phase = { kind: "turnComplete" };
    return true;
  }
  if (!choice.candidateIds.includes(instanceId)) return false;
  const removed = removeEquipmentStats(state, player, instanceId);
  if (!removed) return false;

  const from = player.baseDefense;
  player.baseDefense += Math.max(0, Math.floor(effect.defenseBonus));
  const amount = player.baseDefense - from;
  if (amount > 0) {
    emit(state, {
      type: "baseStatChanged",
      playerId: player.id,
      stat: "defense",
      from,
      to: player.baseDefense,
    });
  }
  addHistory(state, effect.acceptedNarration({
    playerName: player.name,
    equipmentName: EQUIPMENT[removed.kind].name,
    amount,
  }));
  state.phase = { kind: "turnComplete" };
  return true;
}
