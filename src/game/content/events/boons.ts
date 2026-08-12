import { defineMapEvents } from "./definition";

export const BOON_EVENTS = defineMapEvents("boon", {
  veteranGuidance: {
    name: "武者指点",
    description: "基础攻击永久增加 1 点。",
    // 永久成长比一次性事件稀少：单项权重是旧事件的一半。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "adjustBaseStat",
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
      type: "adjustBaseStat",
      stat: "defense",
      amount: 1,
      narration: ({ playerName, amount }) =>
        `${playerName}参悟守护碑铭，基础防御永久增加 ${amount} 点。`,
    }],
  },

  harmony: {
    name: "调和",
    description: "你可以将 1 点基础攻击转化为基础防御，或将 1 点基础防御转化为基础攻击。",
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "offerBaseStatConversion",
      amount: 1,
      narration: ({ playerName }) =>
        `调和之力在${playerName}体内流转，等待其重新分配攻守。`,
      convertedNarration: ({ playerName, fromStat, toStat, amount }) =>
        `${playerName}完成调和，将 ${amount} 点${fromStat === "attack" ? "基础攻击" : "基础防御"}转化为${toStat === "attack" ? "基础攻击" : "基础防御"}。`,
      declinedNarration: ({ playerName }) =>
        `${playerName}维持原有攻守，放弃了本次调和。`,
    }],
  },
});
