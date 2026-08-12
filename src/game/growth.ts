import { emit } from "./state";
import type { GameState, Player, StatGrowthOption } from "./types";

/**
 * 阶段首领的永久成长：三选一，由玩家自己点。
 *
 * 三档刻意不等价，也不打算等价——攻防各 +1 是立刻能感到的，生命上限 +5 是
 * 换取容错。一局里只有两次机会（山脚、云腰；峰顶打完直接结算），所以这两次
 * 选择要能拉开两个玩家的成长方向，做成等价的数值反而没得选。
 *
 * 加点直接落在 baseAttack / baseDefense / maxHp 上，而不是挂一条 StatModifier：
 * 这三项是玩家的底子，装备和赐福才是叠在底子上的修正，混在一起之后
 * 「脱下这件装备我还剩多少」就不再看得出来了。
 */
export const STAT_GROWTH = {
  attack: { name: "攻击 +1", description: "永久提高攻击，每一次出手都更疼。", value: 1 },
  defense: { name: "防御 +1", description: "永久提高防御，挨打时少扣一点。", value: 1 },
  maxHp: { name: "生命上限 +5", description: "永久提高生命上限，并立即补上这 5 点。", value: 5 },
} as const satisfies Record<
  StatGrowthOption,
  { name: string; description: string; value: number }
>;

export const STAT_GROWTH_OPTIONS = Object.keys(STAT_GROWTH) as StatGrowthOption[];

export function applyStatGrowth(
  state: GameState,
  player: Player,
  option: StatGrowthOption,
) {
  if (option === "attack") {
    player.baseAttack += STAT_GROWTH.attack.value;
    return;
  }
  if (option === "defense") {
    player.baseDefense += STAT_GROWTH.defense.value;
    return;
  }
  // 上限涨了就把那几点一起给，和赐福的 maxHp 加成保持同一种手感：
  // 否则「生命上限 +5」在满血时等于什么都没发生，选它的人当场亏一步。
  const maxHpBefore = player.maxHp;
  const hpBefore = player.hp;
  player.maxHp += STAT_GROWTH.maxHp.value;
  player.hp = Math.min(player.maxHp, player.hp + STAT_GROWTH.maxHp.value);
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
    reason: "growth",
  });
}
