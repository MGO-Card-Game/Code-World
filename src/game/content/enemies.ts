import type { EnemyDefinition } from "../types";

/** 怪物基础属性与默认奖励。地图区域负责决定哪些怪物会出现。 */
export const ENEMIES: Record<string, EnemyDefinition> = {
  slime: { id: "slime", name: "史莱姆", maxHp: 8, attack: 2, defense: 1, reward: "scroll" },
  wolf: { id: "wolf", name: "山狼", maxHp: 11, attack: 3, defense: 2, reward: "scroll" },
  golem: { id: "golem", name: "石像守卫", maxHp: 15, attack: 4, defense: 3, reward: "equipment" },
  dragon: { id: "dragon", name: "峰顶巨龙", maxHp: 24, attack: 5, defense: 4, reward: "boss" },
};
