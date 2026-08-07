import { defineEnemies } from "./definition";

/**
 * 强敌：不进随机池，只在强敌格出现，当区域关卡。
 *
 * 数值定在同区游荡怪之上、峰顶巨龙之下（玩家当前开局 20 / 攻 5 / 防 2；
 * 游荡怪成为精英后会增加 4 点生命并叠加一条词缀，巨龙为 50/5/4）。
 * 强敌战走的是普通 PvE 结算：胜利发奖励，战败退回休整点。
 */
export const APEX_ENEMIES = defineEnemies("apex", {
  banditChief: {
    name: "山匪头目",
    maxHp: 18,
    attack: 5,
    defense: 3,
    regions: { foothill: 1 },
    abilities: [{
      name: "重斧",
      description: "攻击骰中出现最高点时，额外造成 2 点无视防御的伤害。",
    }],
    effects: {
      // 取本次实际骰面上限而不是盯着 6，理由同旧骑士长剑：
      // 骰面会被别的效果改，盯死数字会越加越偏。多骰时只加一次。
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (!roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 2;
        addBattleLog(`山匪头目的重斧砸中要害，额外造成 2 点伤害。`);
      },
    },
  },

  frostFang: {
    name: "霜牙巨兽",
    maxHp: 22,
    attack: 5,
    defense: 4,
    regions: { mountainside: 1 },
    abilities: [{
      name: "霜息",
      description: "自身生命高于一半时，本次攻击 +2。",
    }],
    effects: {
      /*
        越健康越凶，和精英词缀「濒死反扑」正好相反：这只怪要求玩家速攻，
        拖下去反而变弱。血量取上下文给的战斗内数值，别读 player.hp。
        用乘法而不是除法，避免半血刚好卡在浮点边界上。
      */
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack") return;
        if (ownHp * 2 <= ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("霜牙巨兽吐出霜息，本次攻击 +2。");
      },
    },
  },
});
