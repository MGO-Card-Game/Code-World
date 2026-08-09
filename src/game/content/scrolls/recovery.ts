import type { ScrollDefinition } from "./definition";

/** 疗牌：可在地图阶段使用，也可以在任意一侧战斗选牌时使用。 */
export const RECOVERY_SCROLLS = {
  regenerativeTonic: {
    name: "再生秘药",
    description: "恢复 7 点生命",
    rarity: "R",
    timings: ["map", "beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "heal", amount: 7 }],
  },

  firstAidBandage: {
    name: "急救绷带",
    description: "恢复 3 点生命",
    rarity: "N",
    timings: ["map", "beforeAttackRoll", "beforeDefenseRoll"],
    effects: [{ type: "heal", amount: 3 }],
  },

  gameMeat: {
    name: "野味",
    description: "恢复 5 点生命",
    rarity: "N",
    timings: ["map", "beforeAttackRoll", "beforeDefenseRoll"],
    /**
     * 篝火事件专属，不进随机卡池。
     *
     * 它是一张无代价的战地药剂：同样回 5 点，却不必放弃移动。作为一次性事件的
     * 产物没问题，混进宝箱和战斗奖励就等于让战地药剂的代价白设了。
     */
    drawable: false,
    effects: [{ type: "heal", amount: 5 }],
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
