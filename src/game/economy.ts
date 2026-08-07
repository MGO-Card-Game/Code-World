import { blessingDefinition } from "./content/blessings";
import { grantScroll, rewardSecret } from "./resources";
import { addHistory, emit } from "./state";
import type {
  GameAction,
  GameState,
  GoldChangeReason,
  Player,
} from "./types";

/**
 * 金币的数值与原子操作集中在这里。
 *
 * 规则层只通过 grant / spend / transfer 改金币，保证赐福倍率、非负边界和事件流
 * 不会散落在战斗、事件与商店的各条流程里。
 */
/** 一枚旧版金币折算为 10 个当前金币单位；统一调整量级时只改这里。 */
export const GOLD_SCALE = 10;

export const ECONOMY = {
  pveGold: 5 * GOLD_SCALE,
  eliteBonusGold: 5 * GOLD_SCALE,
  treasureGold: 5 * GOLD_SCALE,
  eventGold: 5 * GOLD_SCALE,
  pvpTransferPercent: 20,
  shop: {
    scroll: { price: 10 * GOLD_SCALE },
    healing: { price: 4 * GOLD_SCALE, amount: 5 },
  },
} as const;

function goldGainMultiplier(player: Player) {
  return player.blessings.reduce((product, owned) => {
    const multiplier = blessingDefinition(owned.kind).effects
      ?.filter((effect) => effect.type === "goldGainMultiplier")
      .reduce((value, effect) => value * effect.multiplier, 1) ?? 1;
    return product * multiplier;
  }, 1);
}

/** 奖励金币会吃获得倍率；支付和玩家间转移不会凭空增发金币。 */
export function grantGold(
  state: GameState,
  player: Player,
  baseAmount: number,
  reason: Extract<GoldChangeReason, "pveReward" | "treasure" | "event">,
) {
  const normalized = Math.max(0, Math.floor(baseAmount));
  const amount = Math.max(0, Math.floor(normalized * goldGainMultiplier(player)));
  if (amount === 0) return 0;
  const from = player.gold;
  player.gold += amount;
  emit(state, { type: "goldChanged", playerId: player.id, from, to: player.gold, reason });
  return amount;
}

export function spendGold(state: GameState, player: Player, amount: number) {
  const normalized = Math.max(0, Math.floor(amount));
  if (normalized === 0 || player.gold < normalized) return false;
  const from = player.gold;
  player.gold -= normalized;
  emit(state, { type: "goldChanged", playerId: player.id, from, to: player.gold, reason: "shop" });
  return true;
}

export function pvpGoldTransferAmount(loser: Pick<Player, "gold">) {
  const balance = Math.max(0, Math.floor(loser.gold));
  return Math.floor(balance * ECONOMY.pvpTransferPercent / 100);
}

export function transferPvpGold(state: GameState, loser: Player, winner: Player) {
  const amount = pvpGoldTransferAmount(loser);
  if (amount <= 0) return 0;
  const loserBefore = loser.gold;
  const winnerBefore = winner.gold;
  loser.gold -= amount;
  winner.gold += amount;
  emit(state, {
    type: "goldChanged",
    playerId: loser.id,
    from: loserBefore,
    to: loser.gold,
    reason: "pvpTransfer",
  });
  emit(state, {
    type: "goldChanged",
    playerId: winner.id,
    from: winnerBefore,
    to: winner.gold,
    reason: "pvpTransfer",
  });
  return amount;
}

export function canUseShop(
  state: Pick<GameState, "phase" | "activePlayerId" | "map">,
  player: Pick<Player, "id" | "position">,
) {
  return state.phase.kind === "turnComplete"
    && state.activePlayerId === player.id
    && state.map.tiles[player.position]?.safeZone === true;
}

export function buyShopItem(
  state: GameState,
  item: Extract<GameAction, { type: "buyShopItem" }>["item"],
) {
  const player = state.players[state.activePlayerId];
  if (!player || !canUseShop(state, player)) return false;

  if (item === "scroll") {
    if (!spendGold(state, player, ECONOMY.shop.scroll.price)) return false;
    const reward = grantScroll(state, player);
    const line = (what: string) => `${player.name}在营地花费 ${ECONOMY.shop.scroll.price} 金币购买了${what}。`;
    addHistory(state, line(reward.name), rewardSecret(player, line, reward));
    return true;
  }

  if (player.hp >= player.maxHp) return false;
  if (!spendGold(state, player, ECONOMY.shop.healing.price)) return false;
  const hpBefore = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + ECONOMY.shop.healing.amount);
  const healed = player.hp - hpBefore;
  emit(state, {
    type: "playerHpChanged",
    playerId: player.id,
    from: hpBefore,
    to: player.hp,
    maxHp: player.maxHp,
    reason: "shop",
  });
  addHistory(
    state,
    `${player.name}在营地花费 ${ECONOMY.shop.healing.price} 金币，恢复了 ${healed} 点生命。`,
  );
  return true;
}
