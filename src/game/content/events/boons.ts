import { defineMapEvents } from "./definition";

export const BOON_EVENTS = defineMapEvents("boon", {
  veteranGuidance: {
    name: "武者指点",
    description: "基础攻击永久增加 1 点。",
    // 永久成长比一次性事件稀少：单项权重是旧事件的一半。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "increaseBaseStat",
      stat: "attack",
      amount: 1,
      narration: ({ playerName, amount }) =>
        `${playerName}得到武者指点，基础攻击永久增加 ${amount} 点。`,
    }],
  },

  guardianInscription: {
    name: "守护碑铭",
    description: "基础防御永久增加 1 点。",
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "increaseBaseStat",
      stat: "defense",
      amount: 1,
      narration: ({ playerName, amount }) =>
        `${playerName}参悟守护碑铭，基础防御永久增加 ${amount} 点。`,
    }],
  },
});
