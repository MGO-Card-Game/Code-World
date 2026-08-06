import { defineEnemies } from "./definition";

/**
 * 漫游怪：战斗格与精英格的随机池。
 *
 * 三段路线各自形成一条梯度：山脚认识不同攻防轮廓，山腰加入爆发和特殊伤害，
 * 山顶在保留过渡怪的同时提高生命与攻击压力。权重写在怪身上，由 index 组装区域池。
 */
export const ROAMING_ENEMIES = defineEnemies("roaming", {
  slime: {
    name: "史莱姆",
    maxHp: 5,
    attack: 1,
    defense: 0,
    regions: { foothill: 2 },
  },

  wolf: {
    name: "山狼",
    maxHp: 8,
    attack: 2,
    defense: 1,
    regions: { foothill: 1, mountainside: 2, summit: 1 },
  },

  golem: {
    name: "石像守卫",
    maxHp: 13,
    attack: 3,
    defense: 2,
    regions: { mountainside: 1, summit: 2 },
  },

  caveBats: {
    name: "岩穴蝠群",
    maxHp: 6,
    attack: 2,
    defense: 0,
    regions: { foothill: 1 },
    // 比史莱姆更容易打出高点数，但依然脆弱，是山脚的波动型敌人。
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
  },

  thornbackBoar: {
    name: "荆背野猪",
    maxHp: 10,
    attack: 1,
    defense: 2,
    regions: { foothill: 1, mountainside: 1 },
  },

  mistSpider: {
    name: "雾毒蜘蛛",
    maxHp: 9,
    attack: 3,
    defense: 1,
    regions: { mountainside: 1, summit: 1 },
    effects: {
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (!roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 1;
        addBattleLog("雾毒蜘蛛命中要害，毒素额外造成 1 点伤害。");
      },
    },
  },

  thunderEagle: {
    name: "雷羽鹰",
    maxHp: 10,
    attack: 4,
    defense: 0,
    regions: { mountainside: 1, summit: 1 },
  },

  iceShellLizard: {
    name: "冰壳蜥",
    maxHp: 15,
    attack: 2,
    defense: 2,
    regions: { summit: 1 },
  },
});
