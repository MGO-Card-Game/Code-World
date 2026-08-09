import { defineEquipment } from "./definition";

/**
 * 空白护符开战时抽到的那一面，存进 `OwnedEquipment.battleMemo`。
 *
 * 暗格只能放数字，所以这里给两个取值起了名字，而不是在代码里散落 0 和 1。
 * 具体数值无所谓，只要写和读用的是同一个常量。
 */
const TALISMAN_ATTACK = 1;
const TALISMAN_DEFENSE = 2;

/** 饰品：骰子控制、探索与条件效果。槽位有两个，是唯一能叠的分类。 */
export const ACCESSORIES = defineEquipment("accessory", {
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

  huntersPointer: {
    name: "猎人的指针",
    description: "地图移动骰上限 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "movement", value: 1 }],
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

  blackSunShard: {
    name: "黑日碎片",
    description: "攻击、防御和地图移动骰上限各 +1；每使用一张卷轴，损失 1 点生命",
    rarity: "SR",
    modifiers: [
      { type: "dieSides", die: "attack", value: 1 },
      { type: "dieSides", die: "defense", value: 1 },
      { type: "dieSides", die: "movement", value: 1 },
    ],
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
