import type {
  EnemyDefinition,
  EquipmentKind,
  MapTile,
  ScrollKind,
  ScrollTiming,
} from "./types";

export const MAP: MapTile[] = [
  { id: 0, type: "start", label: "山脚营地", safeZone: true },
  { id: 1, type: "event", label: "岔路奇遇" },
  { id: 2, type: "battle", label: "史莱姆", enemyId: "slime" },
  { id: 3, type: "treasure", label: "旧木宝箱" },
  { id: 4, type: "spring", label: "微光泉水" },
  { id: 5, type: "battle", label: "山狼", enemyId: "wolf" },
  { id: 6, type: "event", label: "风蚀石门" },
  { id: 7, type: "treasure", label: "旅者遗物" },
  { id: 8, type: "battle", label: "山狼", enemyId: "wolf" },
  { id: 9, type: "spring", label: "半山泉眼" },
  { id: 10, type: "battle", label: "石像守卫", enemyId: "golem" },
  { id: 11, type: "event", label: "悬崖栈道" },
  { id: 12, type: "treasure", label: "古代秘藏" },
  { id: 13, type: "battle", label: "石像守卫", enemyId: "golem" },
  { id: 14, type: "spring", label: "云上清泉" },
  { id: 15, type: "event", label: "雷鸣山口" },
  { id: 16, type: "treasure", label: "登顶补给" },
  { id: 17, type: "boss", label: "峰顶巨龙", enemyId: "dragon", safeZone: true },
];

export const ENEMIES: Record<string, EnemyDefinition> = {
  slime: { id: "slime", name: "史莱姆", maxHp: 8, attack: 2, defense: 1, reward: "scroll" },
  wolf: { id: "wolf", name: "山狼", maxHp: 11, attack: 3, defense: 2, reward: "scroll" },
  golem: { id: "golem", name: "石像守卫", maxHp: 15, attack: 4, defense: 3, reward: "equipment" },
  dragon: { id: "dragon", name: "峰顶巨龙", maxHp: 24, attack: 5, defense: 4, reward: "boss" },
};

export interface ScrollDefinition {
  name: string;
  description: string;
  /** 什么时候能打这张牌，界面据此决定攻/防方各自看到哪些牌 */
  timing: ScrollTiming;
}

/**
 * 已实现的卷轴。GameRule 8.8 还规划了精准、坚守、狂暴、闪避四种，
 * 补进来时只需要在这里加条目并实现对应的 effectType，界面不用动。
 */
export const SCROLLS: Record<ScrollKind, ScrollDefinition> = {
  might: { name: "力量卷轴", description: "本次攻击 +3", timing: "beforeAttackRoll" },
  guard: { name: "护盾卷轴", description: "本次防御 +3", timing: "beforeDefenseRoll" },
};

export const EQUIPMENT: Record<EquipmentKind, { name: string; description: string }> = {
  sword: { name: "铁剑", description: "攻击永久 +1" },
  shield: { name: "木盾", description: "防御永久 +1" },
  charm: { name: "生命护符", description: "生命上限 +4，获得时恢复 4" },
};

export const TILE_ICON: Record<MapTile["type"], string> = {
  start: "⌂",
  battle: "⚔",
  treasure: "◆",
  spring: "✦",
  event: "?",
  boss: "♛",
};
