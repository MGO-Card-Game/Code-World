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
});
