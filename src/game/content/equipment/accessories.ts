import { defineEquipment } from "./definition";

/**
 * 空白护符开战时抽到的那一面，存进 `OwnedEquipment.battleMemo`。
 *
 * 暗格只能放数字，所以这里给两个取值起了名字，而不是在代码里散落 0 和 1。
 * 具体数值无所谓，只要写和读用的是同一个常量。
 */
const TALISMAN_ATTACK = 1;
const TALISMAN_DEFENSE = 2;

/** 战鼓耳坠暗格：下一次应该强化哪一种骰。 */
const WAR_DRUM_ATTACK = 1;
const WAR_DRUM_DEFENSE = 2;

/** 逆刻沙漏用位标记本场已经强化过的两种骰。 */
const HOURGLASS_ATTACK_SPENT = 1;
const HOURGLASS_DEFENSE_SPENT = 2;

/** 饰品：骰子控制、探索与条件效果。槽位有两个，是唯一能叠的分类。 */
export const ACCESSORIES = defineEquipment("accessory", {
  inkBambooBracelet: {
    name: "墨竹手环",
    description: "地图移动骰数量 +1",
    rarity: "SR",
    modifiers: [{ type: "diceCount", die: "movement", value: 1 }],
  },

  fateCoin: {
    name: "命运硬币",
    description: "你的攻击骰和防御骰只会掷出最小值或最大值",
    rarity: "PR",
    modifiers: [],
    effects: {
      beforeRoll({ modifiers }) {
        modifiers.extremeFaces = true;
      },
    },
  },

  charm: {
    name: "生命护符",
    description: "生命上限 +4，获得时恢复 4 点生命",
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
        天然成立；**后半句目前没有对应实现**。

        这里原本写的是"换成了 8.5 的机会成本——用王冠的那一轮，D20、满载骰池、
        巨龙打击都打不出来"，那句是错的：8.5 与 27.3 都写明每方每回合可以使用
        任意张卷轴。真要还原原文的限制，得另做一个"本场禁改骰"的状态。
      */
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("fateCrownDecree");
      },
    },
  },

  crackedDieFace: {
    name: "裂纹骰面",
    description: "每场战斗开始时获得一张「裂纹骰面」卷轴，可将一颗骰定为 4",
    rarity: "N",
    modifiers: [],
    effects: {
      // 和命运王冠、王座破坏者同一套路：每场战斗一次的主动技 = 开战时发一张战斗限定牌。
      // 这张是三者里最便宜的一版，所以只值 N——换掉的是骰子的两头，不是把它拉满。
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("crackedDieFaceLock");
      },
    },
  },

  frayedBracers: {
    name: "破损护腕",
    description: "攻击和防御骰上限各 +1；每使用一张卷轴，损失 1 点生命",
    rarity: "N",
    modifiers: [
      { type: "dieSides", die: "attack", value: 1 },
      { type: "dieSides", die: "defense", value: 1 },
    ],
    keywords: ["selfCost"],
    effects: {
      /*
        黑日碎片的 N 档前身：少了移动骰那一条，代价一模一样。两张同时穿得起
        （饰品有两个槽），那时每张卷轴就要收 2 点血——这是刻意留着的组合，
        代价类装备叠起来越来越疼是它该有的样子。

        「损失生命」不是「受到伤害」的那一整套理由见黑日碎片：走 loseHp，
        不过 beforeDamage，否则灰铁胸甲会拿这 1 点自损白吃掉一次充能。
      */
      onScrollUsed({ player, loseHp }) {
        loseHp(1, `破损护腕的裂口渗出血来，${player.name}损失 1 点生命。`);
      },
    },
  },

  scavengersSatchel: {
    name: "拾荒者背袋",
    description: "每场战斗开始时获得一张「拾荒者背袋」卷轴，可将本次防御 +2",
    rarity: "N",
    modifiers: [],
    effects: {
      // 套路同裂纹骰面/命运王冠：每场战斗一次的主动技 = 开战时发一张战斗限定牌。
      // 和同为 N 档的裂纹骰面分工：那张管骰子的两头，这张只是一次纯防御补正。
      onBattleStart({ grantBattleScroll }) {
        grantBattleScroll("scavengersSatchelGuard");
      },
    },
  },

  huntersPointer: {
    name: "猎人的指针",
    description: "地图移动骰和攻击骰上限 +1",
    rarity: "N",
    modifiers: [
      { type: "dieSides", die: "movement", value: 1 },
      { type: "dieSides", die: "attack", value: 1 }
    ],
  },

  brassCompass: {
    name: "黄铜罗盘",
    description: "地图移动骰和攻击骰上限 +1",
    rarity: "N",
    modifiers: [
      { type: "dieSides", die: "movement", value: 1 },
      { type: "dieSides", die: "attack", value: 1 },
    ],
  },

  engravedArmlet: {
    name: "刻纹臂环",
    description: "攻击骰和防御骰上限各 +1",
    rarity: "R",
    modifiers: [
      { type: "dieSides", die: "attack", value: 1 },
      { type: "dieSides", die: "defense", value: 1 },
    ],
  },

  bloodOathRing: {
    name: "血誓指环",
    description: "战斗生命值低于一半时，攻击骰和防御骰上限 +1",
    rarity: "R",
    modifiers: [],
    effects: {
      beforeRoll({ ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (ownHp * 2 >= ownMaxHp) return;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 1;
        addBattleLog("血誓指环回应伤势，本次骰面上限 +1。");
      },
    },
  },

  warDrumEarring: {
    name: "战鼓耳坠",
    description: "攻击与防御骰上限各 +1；任一骰掷出 1 时，下一次相反类型的骰子总值 +3",
    rarity: "SR",
    modifiers: [
      { type: "dieSides", die: "attack", value: 1 },
      { type: "dieSides", die: "defense", value: 1 },
    ],
    effects: {
      /*
        攻防轮替正好形成鼓点：攻击低点给下一次防御蓄力，防御低点给下一次攻击蓄力。
        多骰时任意一颗出现 1 都只蓄一次；beforeRoll 先消费、afterRoll 再决定是否续上。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        const expected = dieKind === "attack" ? WAR_DRUM_ATTACK : WAR_DRUM_DEFENSE;
        if (item.battleMemo !== expected) return;
        delete item.battleMemo;
        modifiers.flatBonus += 3;
        addBattleLog(`战鼓耳坠擂响回拍，本次${dieKind === "attack" ? "攻击" : "防御"} +3。`);
      },
      afterRoll({ dieKind, roll, item, addBattleLog }) {
        if (!roll.dice.includes(1)) return;
        item.battleMemo = dieKind === "attack" ? WAR_DRUM_DEFENSE : WAR_DRUM_ATTACK;
        addBattleLog(
          `战鼓耳坠收下低沉鼓点，下一次${dieKind === "attack" ? "防御" : "攻击"} +3。`,
        );
      },
    },
  },

  reverseHourglass: {
    name: "逆刻沙漏",
    description: "每场战斗第一次攻击和第一次防御各额外投 1 个骰子",
    rarity: "PR",
    modifiers: [],
    effects: {
      /*
        一个数字按位记录攻、防是否已经触发，避免两种次数互相挤掉。额外攻击会重新
        经过钩子，但对应位已经写入，因此同一回合也不会重复获得骰子。
      */
      beforeRoll({ dieKind, item, modifiers, addBattleLog }) {
        const spentFlag = dieKind === "attack"
          ? HOURGLASS_ATTACK_SPENT
          : HOURGLASS_DEFENSE_SPENT;
        const spent = item.battleMemo ?? 0;
        if ((spent & spentFlag) !== 0) return;
        item.battleMemo = spent | spentFlag;
        modifiers.extraDice += 1;
        addBattleLog(`逆刻沙漏倒转片刻，本场第一次${dieKind === "attack" ? "攻击" : "防御"}额外投 1 个骰子。`);
      },
    },
  },

  blackSunShard: {
    name: "黑日碎片",
    description: "攻击、防御和地图移动骰上限各 +1；每使用一张卷轴，损失 1 点生命",
    rarity: "SR",
    modifiers: [
      { type: "dieSides", die: "attack", value: 1 },
      { type: "dieSides", die: "defense", value: 1 },
      { type: "dieSides", die: "movement", value: 1 },
    ],
    keywords: ["selfCost"],
    effects: {
      /*
        newCard.md 把它归在「高收益、高代价」那一档，代价就得真能疼到人：
        战斗里这 1 点可以直接把自己扣倒，引擎会接着判负。地图上只保留 1 点，
        不是手下留情，而是那边根本没有战败规则可走——山路落石同理。

        「损失生命」不是「受到伤害」：扣血走 applyBattleHpLoss，不过受击钩子。
        走伤害管线的话，灰铁胸甲会拿这 1 点自损当"本场第一次受到伤害"白吃掉
        一次充能，不灭王铠还会替你挡住自己的代价——两件护甲反而让它变安全。

        原文的「使用道具」在本作里就是卷轴，战斗和地图两处都收。
      */
      onScrollUsed({ player, loseHp }) {
        loseHp(1, `黑日碎片吞下余烬，${player.name}损失 1 点生命。`);
      },
    },
  },

  blankTalisman: {
    name: "空白护符",
    description: "每场战斗开始时，随机将攻击或防御骰上限 +2，持续整场",
    rarity: "R",
    modifiers: [],
    effects: {
      /*
        抽到哪一面写进暗格，整场都按它算——牌面写的是「每场战斗开始时」，
        所以抽签只发生一次，不是每轮重抽。暗格由 clearBattleMemos 在战斗结束时
        统一回收，下一场自然重新抽。

        开战就立刻上一条战报，而不是等第一次投骰时再说：抽到攻击的那一局，
        防御骰从头到尾没有任何变化，玩家不该只能靠"没动静"反推抽到了哪面。
      */
      onBattleStart({ item, random, addBattleLog }) {
        const engraved = random() < 0.5 ? TALISMAN_ATTACK : TALISMAN_DEFENSE;
        item.battleMemo = engraved;
        addBattleLog(
          engraved === TALISMAN_ATTACK
            ? "空白护符浮现出攻击的纹路，本场攻击骰上限 +2。"
            : "空白护符浮现出防御的纹路，本场防御骰上限 +2。",
        );
      },
      beforeRoll({ dieKind, item, modifiers }) {
        const engraved =
          dieKind === "attack" ? TALISMAN_ATTACK : TALISMAN_DEFENSE;
        if (item.battleMemo !== engraved) return;
        modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 2;
      },
    },
  },
});
