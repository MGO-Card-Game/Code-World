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
    maxHp: 8,
    attack: 1,
    defense: 0,
    regions: { foothill: 2 },
    // 一滩软泥，反应迟钝，先攻钉死在低点。
    initiative: { type: "fixed", value: 2 },
  },

  wolf: {
    name: "山狼",
    maxHp: 10,
    attack: 2,
    defense: 1,
    regions: { foothill: 1, mountainside: 2, summit: 1 },
  },

  golem: {
    name: "石像守卫",
    maxHp: 16,
    attack: 3,
    defense: 2,
    regions: { mountainside: 1, summit: 2 },
    // 石身笨重，几乎不可能抢到先手。
    initiative: { type: "fixed", value: 1 },
  },

  caveBats: {
    name: "岩穴蝠群",
    maxHp: 8,
    attack: 2,
    defense: 0,
    regions: { foothill: 1 },
    // 比史莱姆更容易打出高点数，但依然脆弱，是山脚的波动型敌人。
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
    // 蝠群振翅极快，先攻下限抬高，很少手慢。
    initiative: { type: "range", min: 3, max: 6 },
  },

  thornbackBoar: {
    name: "荆背野猪",
    maxHp: 12,
    attack: 1,
    defense: 2,
    regions: { foothill: 1, mountainside: 1 },
    // 冲撞前有个助跑，先攻上限受限。
    initiative: { type: "range", min: 1, max: 4 },
  },

  mistSpider: {
    name: "雾毒蜘蛛",
    maxHp: 14,
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
    // 雾中伏击，先攻下限抬高。
    initiative: { type: "range", min: 4, max: 6 },
  },

  thunderEagle: {
    name: "雷羽鹰",
    maxHp: 14,
    attack: 5,
    defense: 1,
    regions: { mountainside: 1, summit: 1 },
    // 迅雷之翼，先攻钉死在高点。
    initiative: { type: "fixed", value: 5 },
  },

  iceShellLizard: {
    name: "冰壳蜥",
    maxHp: 18,
    attack: 2,
    defense: 4,
    regions: { summit: 1 },
    // 厚重冰甲拖慢反应，先攻钉死在低点。
    initiative: { type: "fixed", value: 2 },
  },

  bioSlug: {
    name: "生化蛞蝓",
    maxHp: 12,
    attack: 3,
    defense: 1,
    /*
      「山脚只作为精英出现」表达不了：精英不是档位而是贴在漫游怪身上的词缀，
      makeRandomTile 对战斗格和精英格调的是同一个 pickRoamingEnemy。
      写了 foothill 权重它就会在山脚的普通战斗格里出现，权重压到最低聊作补偿。
    */
    regions: { foothill: 1, mountainside: 1, summit: 1 },
    abilities: [{
      name: "凝胶质",
      description: "受到的每一次伤害至多为 3 点。",
    }],
    effects: {
      /*
        挂 beforeDamage 而不是防御侧的 damageReduction：那个是"减掉固定几点"，
        表达不了封顶——对面攻击越高它就该挡掉越多。也正因为挂在伤害漏斗上，
        卷轴直伤同样会被压住，不会出现"攻防打不动、直伤照穿"的绕路。

        代价要清楚：这只怪把所有爆发手段（追伤、重击卷轴、黑铁巨剑）一起废掉，
        逼玩家老老实实一刀一刀磨。基础玩家（20/5/2）对它的期望伤害从每回合
        145/36≈4.03 降到 89/36≈2.47，12 点血的等效厚度接近 20。
      */
      beforeDamage({ incoming, capDamage, addBattleLog }) {
        if (incoming <= 3) return;
        capDamage(3);
        addBattleLog("生化蛞蝓的凝胶质吸收了冲击，本次伤害被压到 3 点。");
      },
    },
    // 一团蠕动的胶质，比史莱姆快不了多少。
    initiative: { type: "fixed", value: 2 },
  },

  ragingBear: {
    name: "愤怒的熊",
    maxHp: 20,
    attack: 1,
    defense: 6,
    regions: { mountainside: 1, summit: 1 },
    abilities: [{
      name: "激怒",
      description: "玩家本场每使用一张卷轴，它的攻击 +1。",
    }],
    effects: {
      /*
        张数由 BattleState 记账（scrollsUsedA/B），效果自己数不出来——牌打完就离手了。
        取对手那一侧：PvE 里玩家固定是 a 侧，但按 opponentSide 读才不依赖这件事。

        这是一只反制卷轴的怪：防御 6 高到常规攻击几乎打不穿（玩家 5+d6 对 6+d6，
        期望伤害只有 20/36≈0.56），而唯一的破法——卷轴——每用一张就把它喂强一分。
        它是"忍住别开牌"的考题，不是靠资源硬碾的怪。
      */
      beforeRoll({ dieKind, opponentScrollsUsed, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (opponentScrollsUsed <= 0) return;
        modifiers.flatBonus += opponentScrollsUsed;
        addBattleLog(
          `愤怒的熊被 ${opponentScrollsUsed} 张卷轴激怒，本次攻击 +${opponentScrollsUsed}。`,
        );
      },
    },
    // 熊起势慢但爆发快，先攻不设极端值。
    initiative: { type: "range", min: 2, max: 5 },
  },
});
