import { defineEnemies } from "./definition";

/**
 * 漫游怪：战斗格与精英格的随机池。
 *
 * regions 的权重就是旧 ENEMY_POOLS 的转置——山脚 ["slime","slime","wolf"]
 * 等价于史莱姆 2、山狼 1，手感不变，只是名单换了个持有方。
 */
export const ROAMING_ENEMIES = defineEnemies("roaming", {
  slime: {
    name: "史莱姆",
    maxHp: 8,
    attack: 2,
    defense: 1,
    regions: { foothill: 2 },
    reward: "scroll",
  },

  wolf: {
    name: "山狼",
    maxHp: 11,
    attack: 3,
    defense: 2,
    regions: { foothill: 1, mountainside: 2, summit: 1 },
    reward: "scroll",
  },

  golem: {
    name: "石像守卫",
    maxHp: 15,
    attack: 4,
    defense: 3,
    regions: { mountainside: 1, summit: 2 },
    reward: "equipment",
  },
});
