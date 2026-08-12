import { blessingDefinition } from "./content/blessings";
import { EQUIPMENT, type EquipmentKind } from "./content/equipment";
import type { CardRarity } from "./content/rarity";
import { grantScroll, rewardSecret } from "./resources";
import { addHistory, emit } from "./state";
import type {
  GameAction,
  GameMap,
  GameState,
  GoldChangeReason,
  MapRegionId,
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

/** 价格取整到 GOLD_SCALE 的倍数；商店和赌场的浮动/递增定价共用同一条取整规则。 */
export function roundGold(price: number) {
  return Math.round(price / GOLD_SCALE) * GOLD_SCALE;
}

export const ECONOMY = {
  bossKeyPerStage: 100,
  commerceOutpostTravel: 10 * GOLD_SCALE,
  // 战斗胜利金币砍半：普通/精英战本就高频，原数值让战斗收益盖过宝箱与事件。
  pveGold: 2.5 * GOLD_SCALE,
  eliteBonusGold: 2.5 * GOLD_SCALE,
  /** 词条漫游怪只给小额金币补偿；完整额外卷轴仍属于独立精英怪。 */
  affixBonusGold: 1 * GOLD_SCALE,
  /** 阶段首领一局只打得到两次，给到够在新阶段做一次像样补给的量。 */
  bossGold: 7.5 * GOLD_SCALE,
  treasureGold: 5 * GOLD_SCALE,
  eventGold: 5 * GOLD_SCALE,
  pvpTransferPercent: 20,
  /**
   * 装备离场时的折算价，按品质分档。
   *
   * 上限刻意压在商店卷轴价（10 × GOLD_SCALE）附近而不是按稀有度稀缺性线性放大：
   * 槽位满之后装备是稳定流入的，折算价一旦超过卷轴，攒装备变现就会比用装备更划算。
   */
  equipmentSalvage: {
    N: 2 * GOLD_SCALE,
    R: 4 * GOLD_SCALE,
    SR: 8 * GOLD_SCALE,
    PR: 15 * GOLD_SCALE,
  } satisfies Record<CardRarity, number>,
  shop: {
    scroll: { price: 10 * GOLD_SCALE },
    healing: { price: 4 * GOLD_SCALE, amount: 5 },
  },
} as const;

/** 第一、二、三阶段的钥匙价格依次为 100、200、300 金币。 */
export function bossKeyPrice(map: Pick<GameMap, "regions">, stageId: MapRegionId) {
  const stageIndex = map.regions.findIndex((region) => region.id === stageId);
  if (stageIndex < 0) return 0;
  return (stageIndex + 1) * ECONOMY.bossKeyPerStage;
}

function goldGainMultiplier(player: Pick<Player, "blessings">) {
  return player.blessings.reduce((product, owned) => {
    const multiplier = blessingDefinition(owned.kind).effects
      ?.filter((effect) => effect.type === "goldGainMultiplier")
      .reduce((value, effect) => value * effect.multiplier, 1) ?? 1;
    return product * multiplier;
  }, 1);
}

/** 一次金币获得的最终数额。抽出来是为了让界面能先算出同一个数字再显示。 */
function goldGainAmount(player: Pick<Player, "blessings">, baseAmount: number) {
  const normalized = Math.max(0, Math.floor(baseAmount));
  return Math.max(0, Math.floor(normalized * goldGainMultiplier(player)));
}

/** 奖励金币会吃获得倍率；支付和玩家间转移不会凭空增发金币。 */
export function grantGold(
  state: GameState,
  player: Player,
  baseAmount: number,
  reason: Extract<GoldChangeReason, "pveReward" | "treasure" | "event" | "salvage">,
) {
  const amount = goldGainAmount(player, baseAmount);
  if (amount === 0) return 0;
  const from = player.gold;
  player.gold += amount;
  emit(state, { type: "goldChanged", playerId: player.id, from, to: player.gold, reason });
  return amount;
}

/**
 * 装备折算的预览值。
 *
 * 走的是和 grantGold 同一条取整链路，所以装备选择界面上写的数字就是实际到账的数字——
 * 点石成金这类倍率不会让两者对不上。
 */
export function equipmentSalvageValue(
  player: Pick<Player, "blessings">,
  kind: EquipmentKind,
) {
  return goldGainAmount(player, ECONOMY.equipmentSalvage[EQUIPMENT[kind].rarity]);
}

/**
 * 一件装备离场时折算成金币，返回实际到账数额。
 *
 * 「离场」包含槽位满时放弃新装备、以及选择替换时被换下的旧装备两条路径：
 * 两条路都恰好丢掉一件装备，只补偿其中一条会让玩家为了拿钱而选更差的那一边。
 */
export function salvageEquipment(state: GameState, player: Player, kind: EquipmentKind) {
  return grantGold(state, player, ECONOMY.equipmentSalvage[EQUIPMENT[kind].rarity], "salvage");
}

export function spendGold(
  state: GameState,
  player: Player,
  amount: number,
  reason: Extract<GoldChangeReason, "shop" | "event" | "bossKey"> = "shop",
) {
  const normalized = Math.max(0, Math.floor(amount));
  if (normalized === 0 || player.gold < normalized) return false;
  const from = player.gold;
  player.gold -= normalized;
  emit(state, { type: "goldChanged", playerId: player.id, from, to: player.gold, reason });
  return true;
}

export function pvpGoldTransferAmount(loser: Pick<Player, "gold">) {
  const balance = Math.max(0, Math.floor(loser.gold));
  return Math.floor(balance * ECONOMY.pvpTransferPercent / 100);
}

/**
 * 玩家之间搬钱，返回实际搬走的数额。
 *
 * 刻意不走 goldGainMultiplier：转移不是"获得"，点石成金那 20% 一旦在这里生效，
 * 两名玩家来回转账就能凭空造钱。相遇战代价和勒索共用这一条通路，
 * 就是为了让这个判断只存在一处。
 */
export function transferGold(
  state: GameState,
  from: Player,
  to: Player,
  requested: number,
  reason: Extract<GoldChangeReason, "pvpTransfer" | "event">,
) {
  // 抢不出对方没有的钱，也不会把余额搬成负数
  const amount = Math.max(0, Math.min(Math.floor(requested), Math.floor(from.gold)));
  if (amount <= 0) return 0;
  const fromBefore = from.gold;
  const toBefore = to.gold;
  from.gold -= amount;
  to.gold += amount;
  emit(state, {
    type: "goldChanged",
    playerId: from.id,
    from: fromBefore,
    to: from.gold,
    reason,
  });
  emit(state, {
    type: "goldChanged",
    playerId: to.id,
    from: toBefore,
    to: to.gold,
    reason,
  });
  return amount;
}

export function transferPvpGold(state: GameState, loser: Player, winner: Player) {
  return transferGold(state, loser, winner, pvpGoldTransferAmount(loser), "pvpTransfer");
}

export function canUseShop(
  state: Pick<GameState, "phase" | "activePlayerId" | "map">,
  player: Pick<Player, "id" | "position">,
) {
  return state.phase.kind === "turnComplete"
    && state.activePlayerId === player.id
    && (state.map.tiles[player.position]?.type === "start"
      || state.map.tiles[player.position]?.type === "gate");
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
