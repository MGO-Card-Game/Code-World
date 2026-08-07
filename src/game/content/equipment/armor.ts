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

  namelessKnightArmor: {
    name: "无名骑士遗甲",
    description: "防御骰上限 +2；战斗生命值低于三成时，防御骰上限再 +1",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
    effects: {
      /*
        newCard.md 原文的「额外获得 +1」没写清是骰面还是防御值。这里读成骰面上限，
        与卡面前半句和血誓指环保持同一种量纲——同一张卡上混用两种加法，
        玩家和后续卡牌都无从判断该跟哪一个对齐。
      */
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "defense") return;
        // 用乘法而不是除法，三成不会卡在浮点边界上；正好三成不算"低于"
        if (ownHp * 10 >= ownMaxHp * 3) return;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 1;
        addBattleLog("无名骑士遗甲在濒死时收紧，本次防御骰上限 +1。");
      },
    },
  },
});
