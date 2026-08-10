import { defineEnemies } from "./definition";

/**
 * Boss：只在阶段守关战出现，不携带随机词条。
 * 前两个 Boss 胜利后进入下一阶段并发放战利品；峰顶巨龙胜利后结束游戏。
 */
export const BOSS_ENEMIES = defineEnemies("boss", {
  banditChief: {
    name: "山匪头目",
    maxHp: 28,
    attack: 6,
    defense: 3,
    abilities: [{
      name: "重斧",
      description: "攻击骰中出现最高点时，额外造成 2 点无视防御的伤害。",
    }],
    effects: {
      afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || !roll.dice.includes(roll.sides)) return;
        modifiers.bonusDamage += 2;
        addBattleLog("山匪头目的重斧砸中要害，额外造成 2 点伤害。");
      },
    },
    initiative: { type: "range", min: 2, max: 5 },
  },

  frostFang: {
    name: "霜牙巨兽",
    maxHp: 40,
    attack: 8,
    defense: 5,
    abilities: [
      { name: "霜锋之牙", description: "生命高于 20 点时，攻击 +2。" },
      { name: "霜冻之铠", description: "每当对玩家造成伤害，玩家下一次攻击 -2。" },
    ],
    effects: {
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || ownHp * 2 <= ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("霜牙巨兽亮出霜锋之牙，本次攻击 +2。");
      },
      afterAttack({ damageDealt, penalizeNextPlayerAttack }) {
        if (damageDealt <= 0) return;
        penalizeNextPlayerAttack(
          2,
          "霜冻之铠散出寒气，玩家下一次攻击 -2。",
        );
      },
    },
    initiative: { type: "range", min: 1, max: 4 },
  },

  dragon: {
    name: "峰顶巨龙",
    maxHp: 75,
    attack: 8,
    defense: 6,
    abilities: [
      { name: "龙鳞", description: "防御骰上限 +2（D6 提升为 D8）。" },
      {
        name: "暴怒",
        description: "生命低于 70 点时，攻击 +2、攻击骰变为 D8、防御 -2，防御骰恢复为 D6。",
      },
      {
        name: "真·巨龙打击",
        description: "生命低于 40 点时，攻击再 +2；每次攻击掷骰前对玩家造成 10 点可被防御值减免的伤害。",
      },
    ],
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
    effects: {
      beforeRoll({ dieKind, ownHp, modifiers, addBattleLog, dealDamage }) {
        if (ownHp >= 70) return;
        if (dieKind === "defense") {
          modifiers.flatBonus -= 2;
          // 本体仍保留龙鳞的 +2 骰面；把基础覆盖为 D4 后，最终正好恢复到 D6。
          modifiers.sidesOverride = 4;
          addBattleLog("暴怒让巨龙放弃防守，本次防御 -2，防御骰恢复为 D6。");
          return;
        }
        modifiers.flatBonus += 2;
        modifiers.sidesOverride = 8;
        addBattleLog("峰顶巨龙陷入暴怒，本次攻击 +2，攻击骰提升为 D8。");
        if (ownHp >= 40) return;
        modifiers.flatBonus += 2;
        addBattleLog("峰顶巨龙进入最终阶段，本次攻击再 +2。");
        dealDamage(10, "真·巨龙打击");
      },
    },
  },
});
