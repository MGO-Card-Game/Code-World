import { defineMapEvents } from "./definition";

export const REWARD_EVENTS = defineMapEvents("reward", {
  travelerGift: {
    name: "旅人馈赠",
    description: "获得一张随机卷轴。",
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [{
      type: "grantResource",
      resource: "scroll",
      narration: ({ playerName, rewardName }) =>
        `${playerName}从旅人手中获得${rewardName}。`,
    }],
  },

  fallenAdventurer: {
    name: "冒险者遗骸",
    description: "搜索一具倒毙冒险者的遗物，获得一件随机装备。",
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "grantEquipment",
      quality: "standard",
      narration: ({ playerName, rewardName }) =>
        `${playerName}经过一具冒险者的尸体，搜索遗物后获得${rewardName}。`,
    }],
  },

  weaponInStone: {
    name: "石中武器",
    description: "拔出嵌在巨石中的武器，获得一件高品质概率提升的武器。",
    regions: { foothill: 0.25, mountainside: 0.25, summit: 0.25 },
    effects: [{
      type: "grantEquipment",
      category: "weapon",
      quality: "high",
      narration: ({ playerName, rewardName }) =>
        `${playerName}拔出嵌在石头中的武器，获得${rewardName}。`,
    }],
  },
});
