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
    description: "失去 30% 金币，基础攻击 +1、基础防御 -1。",
    // 净亏事件，权重同基础档的山路落石
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [
      {
        type: "loseGold",
        percent: 30,
        narration: ({ playerName, amount }) =>
          `${playerName}在货摊前没忍住，花掉了 ${amount} 金币。`,
      },
      {
        type: "adjustBaseStat",
        stat: "attack",
        amount: 1,
        narration: ({ playerName, amount }) =>
          `买回来的家伙事儿称手，${playerName}基础攻击永久增加 ${amount} 点。`,
      },
      {
        type: "adjustBaseStat",
        stat: "defense",
        amount: -1,
        // amount 是负数，写文案时取反；基础防御已经是 0 时它会是 0
        narration: ({ playerName, amount }) =>
          amount === 0
            ? `${playerName}想把护具也当了，却发现早就没什么可当的了。`
            : `护具当掉换了钱，${playerName}基础防御永久降低 ${-amount} 点。`,
      },
    ],
  },
});
