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
});
