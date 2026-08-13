import { targetsEliteOrBoss } from "../../enemyClassification";
import type { ScrollDefinition } from "./definition";

/** 攻防转换类：改攻防数值、伤害下限，或者绕过投骰直接结算。 */
export const COMBAT_SWING_SCROLLS = {
  might: {
    name: "力量卷轴",
    description: "本次攻击 +3",
    rarity: "N",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },

  guard: {
    name: "护盾卷轴",
    description: "本次防御 +3",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "flatBonus", value: 3 }],
  },

  dragonStrike: {
    name: "巨龙打击",
    description: "掷骰前造成 10 点伤害，减去其当前防御",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "directDamage", amount: 10 }],
  },

  heavyStrike: {
    name: "痛击",
    description: "掷骰前造成 6 点伤害，减去其当前防御",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "directDamage", amount: 6 }],
  },

  ironWallOrder: {
    name: "铁壁令",
    description: "本次防御中，每颗防御骰最低视为 3",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "minimumRoll", value: 3 }],
  },

  precision: {
    name: "精准卷轴",
    description: "本次攻击中，每颗攻击骰最低视为 4",
    rarity: "N",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "minimumRoll", value: 4 }],
  },

  steadfast: {
    name: "坚守卷轴",
    description: "本次防御中，每颗防御骰最低视为 4",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "minimumRoll", value: 4 }],
  },

  frenzy: {
    name: "狂暴卷轴",
    description: "本次每颗攻击骰投掷两次，取较高结果",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "rollTwice" }],
  },

  dodge: {
    name: "闪避卷轴",
    description: "本次攻防结算的最终伤害减少 3，最低减至 0",
    rarity: "R",
    timings: ["beforeDefenseRoll"],
    effects: [{ type: "damageReduction", amount: 3 }],
  },

  breachDrum: {
    name: "破阵战鼓",
    description: "本次攻击额外投 1 个攻击骰，结果求和",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    effects: [{ type: "extraDice", count: 1 }],
  },

  /*
    拾荒者背袋（饰品·N）在每场战斗开始时发一张这个，战斗结束回收。
    只进防守时机，用已有的临时牌选择表达「每场战斗一次」。
  */
  scavengersSatchelGuard: {
    name: "拾荒者背袋",
    description: "本场战斗限定 · 本次防御 +2",
    rarity: "N",
    timings: ["beforeDefenseRoll"],
    keywords: ["battleOnly"],
    effects: [{ type: "flatBonus", value: 2 }],
    drawable: false,
  },

  /*
    只认强敌：独立精英怪、带词条的漫游怪和首领。普通怪和玩家身上打不出去，
    条件由 usableAgainst 在选牌阶段就挡住，effects 里不再重复判断。
  */
  decapitationOrder: {
    name: "斩首命令",
    description: "精英与首领限定 · 本次攻击额外造成 3 点无视防御的伤害",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    usableAgainst: targetsEliteOrBoss,
    keywords: ["ignoreDefense", "eliteOnly"],
    effects: [{
      type: "custom",
      resolve({ modifiers, addBattleLog }) {
        modifiers.bonusDamage += 3;
        addBattleLog("斩首命令锁定强敌，额外造成 3 点伤害。");
      },
    }],
  },
} satisfies Record<string, ScrollDefinition>;
