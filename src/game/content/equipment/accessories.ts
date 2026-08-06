import { defineEquipment } from "./definition";

/** 饰品：骰子控制、探索与条件效果。槽位有两个，是唯一能叠的分类。 */
export const ACCESSORIES = defineEquipment("accessory", {
  charm: {
    name: "生命护符",
    description: "生命上限 +4，获得时恢复 4",
    rarity: "R",
    modifiers: [{ type: "maxHp", value: 4 }],
  },
});
