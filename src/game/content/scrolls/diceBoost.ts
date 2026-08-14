import type { ScrollDefinition } from "./definition";

/** 骰子强化类：直接改本次投骰的骰面、骰数或结果。 */
export const DICE_BOOST_SCROLLS = {
  octahedralDieSeal: {
    name: "八面骰印",
    description: "本次攻击或防御骰改为 D8",
    rarity: "N",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "dieSides", sides: 8 }],
  },

  mithrilDieSeal: {
    name: "D10",
    description: "本次攻击或防御骰改为 D10",
    rarity: "R",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "dieSides", sides: 10 }],
  },

  fate: {
    name: "D20",
    description: "本次攻击或防御骰改为 D20",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "dieSides", sides: 20 }],
  },

  loadedDicePool: {
    name: "满载骰池",
    description: "本次攻或防额外投 2 个骰子，结果求和",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "extraDice", count: 2 }],
  },

  recklessGamble: {
    name: "孤注一掷",
    description: "本次攻击额外投 2 个骰子；立即损失 2 点生命",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    effects: [
      { type: "extraDice", count: 2 },
      { type: "selfHpLoss", amount: 2 },
    ],
  },

  limitBreak: {
    name: "极限突破",
    description: "本次攻击或防御骰面上限 +3；本轮结算后损失 2 点生命",
    rarity: "SR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [
      { type: "dieSidesBonus", value: 3 },
      { type: "postRoundSelfHpLoss", amount: 2 },
    ],
  },

  rewriteFate: {
    name: "突破",
    description: "本次攻或防额外投 1 个骰子，第一颗骰直接视为最高面",
    rarity: "PR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    effects: [
      { type: "extraDice", count: 1 },
      { type: "maxRoll", count: 1 },
    ],
  },

  reverseScale: {
    name: "逆鳞",
    description: "本次攻击额外投 2 个骰子，第一颗骰直接视为最高面",
    rarity: "PR",
    timings: ["beforeAttackRoll"],
    effects: [
      { type: "extraDice", count: 2 },
      { type: "maxRoll", count: 1 },
    ],
  },

  /*
    命运王冠（饰品·PR）在每场战斗开始时发一张这个，战斗结束回收。

    「每场战斗一次 + 自己挑时机」就此完全落在已有的选牌阶段上：一场只发一张，
    打掉就没了，暗牌与联机归属也照旧。

    注意它当前**只有「一场一张」这一层限制**。这里原本写的是"代价来自 8.5 的机会
    成本——用王冠的那一轮就打不了 D20"，那句是错的：8.5 与 27.3 都写明每方每回合
    可以使用任意张卷轴，引擎收的也是 instanceIds 数组，同一轮既打王冠又打 D20
    完全成立。要不要给它补一层代价是平衡决策，不是这里能顺手改的。

    drawable: false 是关键，否则宝箱和战斗奖励会把它当普通卷轴发出去。
  */
  /*
    王座破坏者（武器·PR）在每场战斗开始时发一张这个，战斗结束回收。
    套路同下面的命运王冠，区别只有两处：这张只有攻击时机，效果是加骰子。

    牌面的「投出三个骰子」写成"额外 2 颗"而不是"把骰数设为 3"：引擎的骰数是累加的
    （基础 1 + extraDice + 装备的 diceCount），写成设定值就要和另外两个来源抢优先级，
    而 8.5 允许一回合打任意多张牌，抢优先级这件事没有正确答案。基础骰数是 1，
    所以今天打出来正好三颗。
  */
  throneBreakerStrike: {
    name: "王座破坏者",
    description: "本次攻击额外投 2 个骰子，结果求和",
    rarity: "PR",
    timings: ["beforeAttackRoll"],
    keywords: ["battleOnly"],
    effects: [{ type: "extraDice", count: 2 }],
    drawable: false,
  },

  /*
    裂纹骰面（饰品·N）在每场战斗开始时发一张这个，战斗结束回收。

    「改为 4」写成 fixedRoll 而不是 minimumRoll：后者抬的是**每一颗**骰子的下限，
    配上满载骰池会把三颗一起拉到 4，那是另一个强度。理由同下面的命运王冠。

    定死一个中间值看着像削弱，实际是这张卡的全部内容：引擎里所有卷轴决策都在
    投骰之前，打出去就等于用 5、6、7 的可能性换掉 1、2、3。差距不大的攻防对拼里
    这笔买卖很划算，需要爆发的时候则完全不该打。
  */
  crackedDieFaceLock: {
    name: "裂纹骰面",
    description: "本次攻或防的第一颗骰直接定为 4",
    rarity: "N",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    keywords: ["battleOnly"],
    effects: [{ type: "fixedRoll", count: 1, value: 4 }],
    drawable: false,
  },

  fateCrownDecree: {
    name: "命运王冠",
    description: "本次攻或防的第一颗骰直接视为最高面",
    rarity: "PR",
    timings: ["beforeAttackRoll", "beforeDefenseRoll"],
    keywords: ["battleOnly"],
    effects: [{ type: "maxRoll", count: 1 }],
    drawable: false,
  },
} satisfies Record<string, ScrollDefinition>;
