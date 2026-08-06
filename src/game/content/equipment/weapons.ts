import { defineEquipment } from "./definition";

/** 武器：主要抬高攻击骰上限，或者改变高点数出现时的结果。 */
export const WEAPONS = defineEquipment("weapon", {
  sword: {
    name: "铁剑",
    description: "攻击永久 +1",
    rarity: "N",
    modifiers: [{ type: "statBonus", stat: "attack", value: 1 }],
  },

  oldKnightSword: {
    name: "旧骑士长剑",
    description: "攻击骰上限 +1；攻击骰掷出最高面时，额外造成 1 点伤害",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      /*
        newCard.md 原文写的是「最高值为 6 时」，但这把剑自己就把攻击骰改成了 D7，
        盯着 6 既打不到真正的最高面，再叠一件加骰面的装备还会越来越偏。
        这里统一取本次实际骰面上限，和断星剑、回响之剑的「最高值」说法一致。
        多骰时任意一颗打出上限即触发，但只加一次。
      */
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (!roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 1;
        addBattleLog(`旧骑士长剑掷出 ${roll.sides}，额外造成 1 点伤害。`);
      },
    },
  },

  monsterHunterBlade: {
    name: "猎魔短刃",
    description: "攻击骰上限 +1；攻击生命值低于一半的目标时，攻击额外 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    effects: {
      // 血量取上下文给的战斗内数值，不要读 player.hp——PvP 期间真实生命值不动
      beforeRoll({ dieKind, opponentHp, opponentMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        // 用乘法而不是除法，避免半血刚好卡在浮点边界上
        if (opponentHp * 2 >= opponentMaxHp) return;
        modifiers.flatBonus += 1;
        addBattleLog("猎魔短刃嗅到血味，本次攻击 +1。");
      },
    },
  },
});
