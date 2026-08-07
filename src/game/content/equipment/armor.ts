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

  ashenIronCuirass: {
    name: "灰铁胸甲",
    description: "防御骰上限 +1；本场战斗第一次受到伤害时，伤害减少 1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        「第一次受到伤害」按真的挨到算：incoming 为 0 的那些回合（防住了、或者
        对手根本没打穿）不消耗次数。这也是它必须挂在 beforeDamage 而不是 beforeRoll
        的原因——防守方在投骰阶段读不到对手的合计，压根不知道这一下会不会挨到。
      */
      beforeDamage({ incoming, item, reduceDamage, addBattleLog }) {
        if (item.battleMemo !== undefined) return;
        if (incoming <= 0) return;
        item.battleMemo = 1;
        reduceDamage(1);
        addBattleLog("灰铁胸甲卸掉了第一次冲击，伤害减少 1。");
      },
    },
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

  undyingKingPlate: {
    name: "不灭王铠",
    description: "防御骰上限 +3；本场战斗第一次受到致命伤害时，保留 1 点生命",
    rarity: "PR",
    modifiers: [{ type: "dieSides", die: "defense", value: 3 }],
    effects: {
      /*
        「致命」按这一下打完会不会归零算，所以判 incoming >= ownHp 而不是判血量高低。
        血只剩 1 点时任何伤害都是致命的，keepAtLeast(1) 会把伤害压到 0——这仍然算
        一次触发，和牌面「第一次受到致命伤害」对得上。
      */
      beforeDamage({ incoming, ownHp, item, keepAtLeast, addBattleLog }) {
        if (item.battleMemo !== undefined) return;
        if (incoming < ownHp) return;
        item.battleMemo = 1;
        keepAtLeast(1);
        addBattleLog("不灭王铠挡住致命一击，保留 1 点生命。");
      },
    },
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
