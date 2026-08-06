import type { ScrollDefinition } from "./definition";

/** 疗牌：可在地图阶段使用，也可以在任意一侧战斗选牌时使用。 */
export const RECOVERY_SCROLLS = {
  firstAidBandage: {
    name: "急救绷带",
    description: "恢复 3 点生命",
    rarity: "N",
    timings: ["map", "beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "heal", amount: 3 }],
  },

  battlefieldMedicine: {
    name: "战地药剂",
    description: "恢复 5 点生命；地图使用时放弃本回合移动，战斗中使用时下次无法移动",
    rarity: "N",
    timings: ["map", "beforeAttackRoll", "beforeDefenseRoll"],
    effects: [
      { type: "heal", amount: 5 },
      { type: "forfeitMovement" },
    ],
  },
} satisfies Record<string, ScrollDefinition>;
