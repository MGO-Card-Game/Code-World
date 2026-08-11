import { defineEquipment } from "./definition";

/** 防具：抬高防御骰上限，或者降低吃亏时的损失。 */
export const ARMOR = defineEquipment("armor", {
  turtleShell: {
    name: "龟壳",
    description: "地图移动骰上限 -2；防御骰上限 +4",
    rarity: "R",
    modifiers: [
      { type: "dieSides", die: "movement", value: -2 },
      { type: "dieSides", die: "defense", value: 4 },
    ],
  },

  parryShield: {
    name: "招架盾",
    description: "完全抵挡对方攻击后，下一次攻击骰上限 +4",
    rarity: "SR",
    modifiers: [],
    effects: {
      beforeDamage({ incoming, item, addBattleLog }) {
        if (incoming !== 0) return;
        item.battleMemo = 1;
        addBattleLog("招架盾完全挡下攻击，为下一次反击蓄势。");
      },
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || item.battleMemo === undefined) return;
        delete item.battleMemo;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 4;
        addBattleLog("招架盾释放反击架势，本次攻击骰上限 +4。");
      },
    },
  },

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

  crackedBulwark: {
    name: "裂口重盾",
    description: "防御骰上限 +2；本场战斗一旦受到伤害，此后防御骰上限 -1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
    effects: {
      /*
        N 档取舍卡不能写成「+1 换 -1」：骰面的收益和代价是线性的，一换一净收益为 0，
        而边境皮甲这种无代价 N 卡净收益是 +0.5——一换一直接变废卡。「+2 换 -1」倒是
        划算，但攻↔防、防↔移、移↔防三条轴向已经被裂甲战斧、沉重壁垒和猎踪靴占满了，
        再塞一张同形状的进来只会把它们顶掉。

        所以这里换一种代价形式：收益会衰减。开场 +2，挨过打之后掉到 +1。
        沉重壁垒（R）的 +2 从头到尾都成立，代价是永久的移动 -1；这张的 +2 只在
        你还没被打中的时候成立，长局里它的实际期望低于 R 档，档位关系立得住。

        暗格记的是「已经裂了」，所以读到之后不清空——它要管整场，由 clearBattleMemos
        在战斗结束时统一回收。incoming <= 0 不算数：防住了的那些回合盾没裂。
      */
      beforeDamage({ incoming, item, addBattleLog }) {
        if (item.battleMemo !== undefined) return;
        if (incoming <= 0) return;
        item.battleMemo = 1;
        addBattleLog("裂口重盾被这一击震开，本场防御骰上限 -1。");
      },
      beforeRoll({ dieKind, item, modifiers }) {
        if (dieKind !== "defense") return;
        if (item.battleMemo === undefined) return;
        // 抵掉 modifiers 里那 +2 中的 1 点：最终骰面是 sidesOverride + sidesBonus，
        // 基础 6 + 2 = D8，裂开之后 5 + 2 = D7
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) - 1;
      },
    },
  },

  blacksmithsApron: {
    name: "铁匠围裙",
    description: "防御骰上限 +1；单次受到的伤害达到 4 点及以上时，伤害减少 2",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        三件减伤甲的分工：灰铁胸甲只咬第一口，磨损铁甲每口都磨 1（R），
        这张只挑大的挡。小额伤害它一点不管，所以在被小刀慢割的对局里
        它就是一件普通的 +1 防具——这正是它留在 N 档的理由。

        阈值读的是 incoming，也就是任何钩子动手之前的快照。用实时值的话，
        同时穿着磨损铁甲时那 1 点减免会把 4 点伤害压到 3，这张就白白失效了；
        护甲关心的是这一击本身有多重，不是别人减完还剩多少。
      */
      beforeDamage({ incoming, reduceDamage, addBattleLog }) {
        if (incoming < 4) return;
        reduceDamage(2);
        addBattleLog("铁匠围裙的厚革吃下这记重击，伤害减少 2。");
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

  oathkeeperCloak: {
    name: "缄誓披风",
    description: "防御骰上限 +1；对手的基础攻击高于你的基础防御时，本场战斗防御 +2",
    rarity: "R",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        只比较角色的 baseAttack/baseDefense 或怪物定义上的原始攻防；装备、赐福、卷轴、
        骰子以及精英词缀都不参与。基础属性在战斗中不会变化，所以逐次判断等价于整场生效。
      */
      beforeRoll({
        dieKind,
        ownBaseDefense,
        opponentBaseAttack,
        modifiers,
        addBattleLog,
      }) {
        if (dieKind !== "defense" || opponentBaseAttack <= ownBaseDefense) return;
        modifiers.flatBonus += 2;
        addBattleLog("缄誓披风在强敌面前收紧，本次防御 +2。");
      },
    },
  },

  duskBellPlate: {
    name: "暮钟板甲",
    description: "防御骰上限 +1；战斗第 4 回合起，每次受到的伤害减少 2",
    rarity: "SR",
    modifiers: [{ type: "dieSides", die: "defense", value: 1 }],
    effects: {
      /*
        用 beforeDamage 而不是防御骰钩子，保证攻防差与卷轴直伤都走同一条减伤规则。
        前四回合只有 +2 骰面，拖入长局后才得到稳定减伤，和残月胸甲的首击爆发分工。
      */
      beforeDamage({ battle, incoming, reduceDamage, addBattleLog }) {
        if (battle.round < 4 || incoming <= 0) return;
        reduceDamage(2);
        addBattleLog("暮钟板甲响起沉声，伤害减少 2。");
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
