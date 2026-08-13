import { defineEnemies } from "./definition";

/**
 * 精英怪：只在精英格出现，按区域权重从独立池抽取。
 *
 * 精英身份来自本体档位，不靠词条；精英怪和 Boss 暂时都不会携带词条。
 * 数值位于同区漫游怪之上、阶段首领之下，能力全部复用现有怪物钩子。
 */
export const ELITE_ENEMIES = defineEnemies("elite", {
  razorbackAlpha: {
    name: "刃脊头狼",
    maxHp: 18,
    attack: 4,
    defense: 2,
    regions: { foothill: 2 },
    abilities: [{
      name: "扑杀",
      description: "自身生命全满时，攻击 +2",
    }],
    effects: {
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || ownHp !== ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("刃脊头狼借势扑杀，本次攻击 +2。");
      },
    },
    initiative: { type: "range", min: 3, max: 6 },
  },

  mireHexer: {
    name: "腐沼巫兽",
    maxHp: 20,
    attack: 4,
    defense: 2,
    regions: { foothill: 1, mountainside: 1 },
    abilities: [{
      name: "蚀骨咒",
      description: "攻击骰掷出最高面时，额外造成 2 点无视防御的伤害",
      keywords: ["ignoreDefense"],
    }],
    effects: {
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || !roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 2;
        addBattleLog("腐沼巫兽的蚀骨咒爆发，额外造成 2 点伤害。");
      },
    },
    initiative: { type: "range", min: 2, max: 5 },
  },

  cliffOgre: {
    name: "断崖巨魔",
    maxHp: 28,
    attack: 6,
    defense: 3,
    regions: { mountainside: 2 },
    abilities: [{
      name: "巨力",
      description: "攻击骰上限 +2",
    }],
    modifiers: [{ type: "dieSides", die: "attack", value: 2 }],
    initiative: { type: "range", min: 1, max: 4 },
  },

  frostWraith: {
    name: "霜幕怨灵",
    maxHp: 24,
    attack: 6,
    defense: 4,
    regions: { mountainside: 1, summit: 1 },
    abilities: [{
      name: "霜幕",
      description: "自身生命低于一半时，防御 +2",
    }],
    effects: {
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "defense" || ownHp * 2 >= ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("霜幕笼罩怨灵，本次防御 +2。");
      },
    },
    initiative: { type: "range", min: 3, max: 6 },
  },

  watcherWyvern: {
    name: "看守者飞龙",
    maxHp: 30,
    attack: 5,
    defense: 4,
    regions: { summit: 2 },
    abilities: [{
      name: "负伤狂怒",
      description: "自身生命低于一半时，攻击 +2",
    }],
    effects: {
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || ownHp * 2 >= ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("负伤的看守者飞龙陷入狂怒，本次攻击 +2。");
      },
    },
    initiative: { type: "range", min: 2, max: 5 },
  },

  thunderRoc: {
    name: "撼雷鹏",
    maxHp: 30,
    attack: 8,
    defense: 3,
    regions: { summit: 2 },
    abilities: [{
      name: "雷坠",
      description: "攻击骰掷出最高面时，额外造成 2 点无视防御的伤害",
      keywords: ["ignoreDefense"],
    }],
    effects: {
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || !roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 2;
        addBattleLog("撼雷鹏引雷坠击，额外造成 2 点伤害。");
      },
    },
    initiative: { type: "fixed", value: 5 },
  },

  obsidianSentinel: {
    name: "黑曜镇守者",
    maxHp: 36,
    attack: 6,
    defense: 6,
    regions: { summit: 1 },
    abilities: [{
      name: "黑曜躯壳",
      description: "受到的每一次伤害至多为 5 点",
      keywords: ["damageCap"],
    }],
    effects: {
      beforeDamage({ incoming, capDamage, addBattleLog }) {
        if (incoming <= 5) return;
        capDamage(5);
        addBattleLog("黑曜躯壳化解冲击，本次伤害被压到 5 点。");
      },
    },
    initiative: { type: "fixed", value: 1 },
  },
});
