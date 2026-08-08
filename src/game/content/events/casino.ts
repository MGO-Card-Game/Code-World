import { defineMapEvents } from "./definition";

export const CASINO_EVENTS = defineMapEvents("casino", {
  casinoRoulette: {
    name: "赌场转盘",
    description: "支付金币转动轮盘，可能空手而归、赢回金币、获得卷轴或装备，也可能转出永久属性头奖；可以反复游玩，费用逐次上涨。",
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "enterCasino",
      narration: ({ playerName }) =>
        `${playerName}走进路边的赌场，转盘已经支好。`,
    }],
  },
});
