import { defineEquipment } from "./definition";

/** 鞋具：让玩家更容易走到关键节点，但不直接取消路线选择。 */
export const SHOES = defineEquipment("shoes", {
  travelerBoots: {
    name: "旅行者短靴",
    description: "地图移动骰上限 +1（D6 → D7）",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
  },
});
