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

  hotSpring: {
    name: "山涧温泉",
    description: "掷 1d10，恢复等量生命。",
    // 均值 5.5 高于山路喘息的固定 3 点，按现有惯例给强事件一半权重。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "heal",
      amount: { dice: 1, sides: 10 },
      narration: ({ playerName, amount, roll }) =>
        `${playerName}浸入山涧温泉，掷出 ${roll} 点，恢复 ${amount} 点生命。`,
    }],
  },
});
