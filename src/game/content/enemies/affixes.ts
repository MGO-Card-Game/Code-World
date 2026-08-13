import type { EnemyEffects, StatModifier } from "../../effects/battleHooks";
import type { KeywordKind } from "../keywords";
import type { CardRarity } from "../rarity";

/**
 * 漫游怪词条：贴在漫游怪身上的一组强化。
 *
 * 精英现在是独立怪物档位，精英怪本身不携带这里的词条。历史类型名继续沿用
 * EliteAffix；结构上词条就是「漫游怪的装备」：一组 modifier 加可选钩子，
 * 使用和装备卡完全相同的两条通路。
 */
export interface EliteAffixDefinition {
  /** 拼在本体名前面：「狂暴的」+「山狼」 */
  name: string;
  description: string;
  rarity: CardRarity;
  /** 牌面关键字，判据同 EnemyAbility.keywords。 */
  keywords?: readonly KeywordKind[];
  modifiers: readonly StatModifier[];
  effects?: EnemyEffects;
}

/**
 * 所有携带词条的漫游怪共享的强化，具体词缀特色叠加在这之上。
 *
 * 只加血，攻防一概交给词缀——这是实测之后定的。攻防差配上 d6，
 * 每 1 点防御都很贵：基础带 +1 攻 +1 防时，基础玩家（18 血 / 攻 4 / 防 2）
 * 对词条山狼的胜率从 55% 掉到 3%，整局步数涨了三十倍。
 *
 * 调平衡时这个数字是第一个该动的地方。
 */
export const ELITE_BASE_MODIFIERS: readonly StatModifier[] = [
  { type: "maxHp", value: 2 },
];

export const ELITE_AFFIXES = {

  frenzied: {
    name: "狂暴的",
    description: "攻击 +2",
    rarity: "R",
    modifiers: [{ type: "statBonus", stat: "attack", value: 2 }],
  },

  ironclad: {
    name: "坚甲的",
    description: "防御 +2",
    rarity: "R",
    modifiers: [{ type: "statBonus", stat: "defense", value: 2 }],
  },

  /*
    走骰面而不是骰数。diceCount +1 是多掷一整颗 d6，期望值直接 +3.5，
    对一条词缀来说太重了——实测精英山狼会掉到 11% 胜率。
    骰面 +2 的期望值是 +1，这才是一条 R 档词缀该有的份量。
  */
  honed: {
    name: "锋锐的",
    description: "攻击骰上限 +2",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 2 }],
  },

  agile: {
    name: "敏捷的",
    description: "防御骰上限 +2",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
  },

  vigorous: {
    name: "生命旺盛的",
    description: "生命上限 +5",
    rarity: "N",
    modifiers: [{ type: "maxHp", value: 5 }],
  },

  venomous: {
    name: "淬毒的",
    description: "攻击时额外造成 1 点伤害",
    rarity: "R",
    keywords: ["ignoreDefense"],
    modifiers: [],
    effects: {
      /*
        只在攻击侧加。RollModifiers.bonusDamage 的注释写明防守方的反伤需要
        自己的 battleDamage 事件与击倒判定顺序，那套还没做——在防守侧写它
        不会报错，只会让伤害悄悄算错。
      */
      afterRoll({ dieKind, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        modifiers.bonusDamage += 1;
        addBattleLog("毒液渗入伤口，额外造成 1 点伤害。");
      },
    },
  },

  cornered: {
    name: "濒死反扑",
    description: "自身生命低于一半时，攻击 +3",
    rarity: "SR",
    modifiers: [],
    effects: {
      // 血量取上下文给的战斗内数值，别读 player.hp；乘法比较避开浮点边界
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (ownHp * 2 >= ownMaxHp) return;
        modifiers.flatBonus += 3;
        addBattleLog("负伤的野兽发起反扑，本次攻击 +3。");
      },
    },
  },
} as const satisfies Record<string, EliteAffixDefinition>;

/** 直接由配置键推导；新增词缀时无需再维护另一份字符串联合类型。 */
export type EliteAffixKind = keyof typeof ELITE_AFFIXES;

export function eliteAffixDefinition(kind: EliteAffixKind): EliteAffixDefinition {
  return ELITE_AFFIXES[kind];
}
