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
    description: "防御骰上限 +3；本场战斗第一次受到致命伤害时，保留一半最大生命（向上取整）",
    rarity: "PR",
    modifiers: [{ type: "dieSides", die: "defense", value: 3 }],
    effects: {
      /*
        「致命」按这一下打完会不会归零算，所以判 incoming >= ownHp 而不是判血量高低。
        目标可能在低于半血时触发，此时 keepAtLeast 会先把伤害压到 0，再由伤害入口
        补足到半血；奇数上限向上取整，确保实际保留不少于最大生命的一半。
      */
      beforeDamage({ incoming, ownHp, ownMaxHp, item, keepAtLeast, addBattleLog }) {
        if (item.battleMemo !== undefined) return;
        if (incoming < ownHp) return;
        item.battleMemo = 1;
        const retainedHp = Math.ceil(ownMaxHp / 2);
        keepAtLeast(retainedHp);
        addBattleLog(`不灭王铠挡住致命一击，保留 ${retainedHp} 点生命。`);
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

  wornIronArmor: {
    name: "磨损铁甲",
    description: "防御骰上限 +1；每次受到伤害都会减少 1",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        和灰铁胸甲的分工：那张是「只咬第一口」，这张是「每口都磨」，
        所以不占用暗格，也就没有次数上限——量级压低到只减 1 点，
        换的是不设「本场第一次」这道门槛。
      */
      beforeDamage({ incoming, reduceDamage, addBattleLog }) {
        if (incoming <= 0) return;
        reduceDamage(1);
        addBattleLog("磨损铁甲卸掉了一部分冲击，伤害减少 1。");
      },
    },
  },

  stoneheartArmor: {
    name: "岩心甲",
    description: "防御骰上限 +1；防御骰掷出 1 时，本次伤害减少 3",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        岩心甲把防御骰的低点转化为减伤：多骰时任意一颗掷出 1 即触发，但每次只减 3。
        damageReduction 直接写在 afterRoll 里就够了——它和 beforeDamage 一样会被计入
        最终伤害公式，不需要另开一个钩子。
      */
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "defense") return;
        if (!roll.dice.includes(1)) return;
        modifiers.damageReduction += 3;
        addBattleLog("岩心甲将防御骰的 1 化作岩障，本次伤害减少 3。");
      },
    },
  },

  waningMoonCuirass: {
    name: "残月胸甲",
    description: "防御骰上限 +2；本场战斗第一次受到伤害时，伤害减半（向下取整）",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
    effects: {
      /*
        「本场第一次」用暗格占位，套路同灰铁胸甲；区别是那张扣固定 1 点，
        这张按比例减免，SR 档需要在大额伤害面前也站得住。减掉的部分是
        incoming - 向下取整后的一半，写成 reduceDamage(实际减免量) 而不是
        直接 keepAtLeast，因为这里关心的是"这一下"本身，不是剩余血量。
      */
      beforeDamage({ incoming, item, reduceDamage, addBattleLog }) {
        if (item.battleMemo !== undefined) return;
        if (incoming <= 0) return;
        item.battleMemo = 1;
        const halved = Math.floor(incoming / 2);
        reduceDamage(incoming - halved);
        addBattleLog(`残月胸甲吸收了这一击的余势，伤害减半至 ${halved}。`);
      },
    },
  },
});
