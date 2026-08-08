import type { MapTile } from "../types";

/** 地图格子的纯展示配置，与怪物、卷轴和装备配置相互独立。 */
export const TILE_ICON: Record<MapTile["type"], string> = {
  start: "⌂",
  battle: "⚔",
  elite: "⚔",
  treasure: "◆",
  blessing: "✧",
  spring: "✦",
  event: "?",
  shop: "¤",
  gate: "♜",
  boss: "♛",
};
