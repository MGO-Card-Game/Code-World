import { defineEnemies } from "./definition";

/**
 * Boss：只在 Boss 格出现，击败即胜利。
 *
 * 因此这一档不写 regions（位置固定），也不写 reward——engine 判完
 * battle.kind === "boss" 就进 gameOver，根本走不到发奖励那一步。
 * 旧结构里巨龙那行的 reward: "boss" 就是一条永远读不到的死配置。
 *
 * 旧版 50 血巨龙叠加「龙鳞」与「暴怒」后，自动对局会出现八万步仍无法
 * 通关的种子。现在启用两个被动时同步下调生命，避免把最终战变成纯粹的
 * 重复尝试；后续经济与成长系统稳定后再重新标定这组数值。
 */
export const BOSS_ENEMIES = defineEnemies("boss", {
  dragon: {
    name: "峰顶巨龙",
    maxHp: 40,
    attack: 5,
    defense: 4,
    abilities: [
      { name: "龙鳞", description: "防御骰上限 +2（D6 提升为 D8）。" },
      { name: "暴怒", description: "自身生命低于一半时，本次攻击 +2。" },
    ],
    modifiers: [{ type: "dieSides", die: "defense", value: 2 }],
    effects: {
      beforeRoll({ dieKind, ownHp, ownMaxHp, modifiers, addBattleLog }) {
        if (dieKind !== "attack" || ownHp * 2 >= ownMaxHp) return;
        modifiers.flatBonus += 2;
        addBattleLog("峰顶巨龙陷入暴怒，本次攻击 +2。");
      },
    },
  },
});
