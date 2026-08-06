import { defineEquipment } from "./definition";

/** 防具：抬高防御骰上限，或者降低吃亏时的损失。 */
export const ARMOR = defineEquipment("armor", {
  shield: {
    name: "木盾",
    description: "防御永久 +1",
    rarity: "N",
    modifiers: [{ type: "statBonus", stat: "defense", value: 1 }],
  },

  borderLeather: {
    name: "边境皮甲",
    description: "防御骰上限 +1（D6 → D7）",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
  },

  heavyBulwark: {
    name: "沉重壁垒",
    description: "防御骰上限 +2，但地图移动骰上限 -1",
    rarity: "R",
    modifiers: [
      { type: "dieSides", die: "defense", value: 2 },
      { type: "dieSides", die: "movement", value: -1 },
    ],
  },
});
