import { defineEnemies } from "./definition";

/**
 * Boss：只在 Boss 格出现，击败即胜利。
 *
 * 因此这一档不写 regions（位置固定），也不写 reward——engine 判完
 * battle.kind === "boss" 就进 gameOver，根本走不到发奖励那一步。
 * 旧结构里巨龙那行的 reward: "boss" 就是一条永远读不到的死配置。
 *
 * 巨龙暂时没有被动。原本打算给它「龙鳞」（防御骰上限 +2）和「暴怒」
 * （半血后攻击 +2），实测下来不能加：这场仗本来就极其吃装备，
 * 自动对局跑十颗种子要 7～462 次才打得过，加上这两个被动之后变成
 * 1668～4441 次，四颗种子里有两颗八万步都打不完。
 * 峰顶平衡得先单独调，调完再谈给它加被动。
 */
export const BOSS_ENEMIES = defineEnemies("boss", {
  dragon: {
    name: "峰顶巨龙",
    maxHp: 24,
    attack: 5,
    defense: 4,
  },
});
