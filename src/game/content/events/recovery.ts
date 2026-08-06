import { defineMapEvents } from "./definition";

export const RECOVERY_EVENTS = defineMapEvents("recovery", {
  roadsideRespite: {
    name: "山路喘息",
    description: "恢复 3 点生命。",
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [{
      type: "heal",
      amount: 3,
      narration: ({ playerName, amount }) =>
        `奇遇带来喘息，${playerName}恢复 ${amount} 点生命。`,
    }],
  },
});
