import { defineMapEvents } from "./definition";
import { ECONOMY } from "../../economy";

export const REWARD_EVENTS = defineMapEvents("reward", {
  lostPurse: {
    name: "遗失的钱袋",
    description: `获得 ${ECONOMY.eventGold} 金币。`,
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    effects: [{
      type: "grantGold",
      amount: ECONOMY.eventGold,
      narration: ({ playerName, amount }) =>
        `${playerName}在路边捡到钱袋，获得 ${amount} 金币。`,
    }],
  },

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
      quality: "highQuality",
      narration: ({ playerName, rewardName }) =>
        `${playerName}拔出嵌在石头中的武器，获得${rewardName}。`,
    }],
  },

  coinRain: {
    name: "金钱雨",
    description: `掷 1d6，获得点数 × ${ECONOMY.eventGold} 金币。`,
    /**
     * 就是「1d6 倍的普通金币事件」，所以乘数直接引用 eventGold 而不是写死 50——
     * 以后调整 GOLD_SCALE 或事件金币档位时，这条不会悄悄脱离基准。
     * 均值 3.5 倍于遗失的钱袋，按大奖给一半权重。
     */
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "grantGold",
      amount: { dice: 1, sides: 6, multiplier: ECONOMY.eventGold },
      narration: ({ playerName, amount, roll }) =>
        `天降金钱雨，${playerName}掷出 ${roll} 点，捡到 ${amount} 金币。`,
    }],
  },

  campfire: {
    name: "旅人篝火",
    description: "获得 2 张野味，每张可恢复 5 点生命。",
    // 一共 10 点可携带的治疗量，还能攒进战斗里用，比一次性回血强，取一半权重。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "grantScroll",
      kind: "gameMeat",
      count: 2,
      narration: ({ playerName, rewardName }) =>
        `${playerName}在旅人的篝火旁分到${rewardName}。`,
    }],
  },

  requisition: {
    name: "拿来主义",
    description: "其余每名玩家各交出一张随机卷轴；手上没牌的人跳过。",
    /*
      四人局一次进账三张牌，是目前单个事件里资源量最大的一个，权重压到最低档。
      它同时是唯一会动别人背包的事件——踩中的人赚，其余三家一起亏，
      出现得太频繁会让牌全靠这一格流转。
    */
    regions: { foothill: 0.25, mountainside: 0.25, summit: 0.25 },
    effects: [{
      type: "takeScrollFromEachOpponent",
      narration: ({ playerName, donorName }) =>
        `${donorName}向${playerName}交出一张卷轴。`,
      emptyNarration: ({ playerName }) =>
        `没有人能向${playerName}交出一张卷轴。`,
    }],
  },

  twinSlayer: {
    name: "双子杀手",
    description: "选择你的一张卷轴，将它的复制品加入你的手牌。",
    // 能复制手里最合适的一张，比随机抽牌更稳定，因此按强化奖励使用半权重。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "duplicateOwnedScroll",
      narration: ({ playerName }) =>
        `双子杀手向${playerName}递出一面染血的镜子，等待一张卷轴的倒影。`,
      selectedNarration: ({ playerName, rewardName }) =>
        `${playerName}借双子杀手的镜子复制了${rewardName}。`,
      emptyNarration: ({ playerName }) =>
        `${playerName}没有可供双子杀手复制的卷轴。`,
    }],
  },

  weaponCollector: {
    name: "武器收藏家",
    description: "你可以将一件装备交给收藏家，使基础防御 +1。",
    // 需要永久失去一件装备才生效，收益稳定但有明确代价，使用半权重。
    regions: { foothill: 0.5, mountainside: 0.5, summit: 0.5 },
    effects: [{
      type: "exchangeEquipmentForDefense",
      defenseBonus: 1,
      narration: ({ playerName }) =>
        `武器收藏家邀请${playerName}交出一件藏品，换取防身心得。`,
      acceptedNarration: ({ playerName, equipmentName, amount }) =>
        `${playerName}将${equipmentName}交给武器收藏家，基础防御 +${amount}。`,
      declinedNarration: ({ playerName }) =>
        `${playerName}谢绝了武器收藏家的交易。`,
      emptyNarration: ({ playerName }) =>
        `${playerName}没有可以交给武器收藏家的装备。`,
    }],
  },
});
