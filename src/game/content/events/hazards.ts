import { defineMapEvents } from "./definition";

export const HAZARD_EVENTS = defineMapEvents("hazard", {
  fallingRocks: {
    name: "山路落石",
    description: "损失 2 点生命，至少保留 1 点生命。",
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [{
      type: "damage",
      amount: 2,
      minimumHp: 1,
      narration: ({ playerName, amount }) =>
        `山路落石！${playerName}损失 ${amount} 点生命。`,
    }],
  },

  mire: {
    name: "泥泞沼泽",
    description: "陷入沼泽，下一回合无法移动。",
    // 丢掉一整回合的行动是比掉 2 点血更重的代价，权重取一半。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "skipNextMovement",
      reason: "沼泽",
      narration: ({ playerName }) =>
        `${playerName}一脚踏进泥泞沼泽，下一回合无法移动。`,
    }],
  },

  impulseBuy: {
    name: "冲动消费",
    description: "花费 30% 金币买下一件危险但趁手的武器：基础攻击 +1，试用时损失 3 点生命。",
    // 净亏事件，权重同基础档的山路落石
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [
      {
        type: "loseGold",
        percent: 30,
        narration: ({ playerName, amount }) =>
          `${playerName}被摊主说动，花掉 ${amount} 金币买下一件锋利却危险的武器。`,
      },
      {
        type: "adjustBaseStat",
        stat: "attack",
        amount: 1,
        narration: ({ playerName, amount }) =>
          `买回来的家伙事儿称手，${playerName}基础攻击永久增加 ${amount} 点。`,
      },
      {
        type: "damage",
        amount: 3,
        minimumHp: 1,
        narration: ({ playerName, amount }) =>
          amount === 0
            ? `${playerName}试用新武器时险些伤到自己，好在及时收手。`
            : `${playerName}试用新武器时一个不慎被利刃划伤，损失 ${amount} 点生命。`,
      },
    ],
  },

  doomPossession: {
    name: "厄运附体",
    description: "接下来 5 个回合，攻击和防御各 -1。",
    // 持续五个本人回合，比一次性掉血更难规避，按强负面事件给半权重。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "applyTimedStatPenalty",
      kind: "doomPossession",
      attack: 1,
      defense: 1,
      turns: 5,
      narration: ({ playerName }) =>
        `${playerName}被厄运附体，接下来 5 个回合攻击和防御各 -1。`,
    }],
  },
});
