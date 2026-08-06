import { defineEquipment } from "./definition";

/** 饰品：骰子控制、探索与条件效果。槽位有两个，是唯一能叠的分类。 */
export const ACCESSORIES = defineEquipment("accessory", {
  charm: {
    name: "生命护符",
    description: "生命上限 +4，获得时恢复 4",
    rarity: "R",
    modifiers: [{ type: "maxHp", value: 4 }],
  },

  fateCrown: {
    name: "命运王冠",
    description: "每场战斗开始时获得一张「命运王冠」卷轴，可将一颗骰视为最高面",
    rarity: "PR",
    modifiers: [],
    effects: {
      /*
        没有做成"装备主动技"，而是每场战斗发一张限定卷轴。

        newCard.md 原文是「每场战斗一次，将一个骰子直接视为最高值；
        使用后本场战斗无法再次修改骰子」。前半句靠"一场只发一张、打掉就没了"
        天然成立；后半句的限制换成了 8.5 的机会成本——用王冠的那一轮，
        D20、满载骰池、巨龙打击都打不出来。
      */
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("fateCrownDecree");
      },
    },
  },
});
