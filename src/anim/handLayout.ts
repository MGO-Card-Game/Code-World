/**
 * 手牌扇形排布的几何计算。
 *
 * 抽成纯函数是为了能直接测——文档 23.2 明确不设手牌上限，
 * 所以“任意张数都不撑破手牌坞”这条约束必须能被断言，而不是靠肉眼看。
 */

/** 单张卡面宽度，与 styles.css 的 .hand-card 保持一致 */
export const HAND_CARD_WIDTH = 96;
/** 手牌坞内容区宽度：960 上限减去左右各 18 内边距 */
export const HAND_RAIL_WIDTH = 924;

/** 张数少时卡牌之间留白 */
const RELAXED_GAP = 10;
/**
 * 重叠时期望每张至少露出的宽度。
 *
 * 注意这是个**期望值而非硬下限**：卡宽 96、坞宽 924，两条约束在 47 张时相撞
 * （18 × 47 + 78 > 924）。撑破布局比卡牌变窄严重得多，所以超过这个张数后
 * 宽度约束优先，卡牌继续收窄成细条。实际手牌远到不了这个量级。
 */
export const HAND_MIN_VISIBLE = 18;
/** HAND_MIN_VISIBLE 能被满足的最大张数 */
export const HAND_LEGIBLE_MAX = 47;
/** 整个扇形的总张角上限（度） */
const MAX_FAN_ANGLE = 26;
/** 边缘卡相对中心卡的最大抬升（像素） */
const MAX_LIFT = 16;

/**
 * 相邻两张牌之间的间距（作为 marginLeft）。
 * 放得下就留白，放不下就收紧到刚好铺满——宽度约束永远优先，绝不溢出。
 */
export function handSpacing(
  count: number,
  railWidth = HAND_RAIL_WIDTH,
  cardWidth = HAND_CARD_WIDTH,
) {
  if (count <= 1) return 0;
  const relaxedWidth = count * cardWidth + (count - 1) * RELAXED_GAP;
  if (relaxedWidth <= railWidth) return RELAXED_GAP;
  return (railWidth - count * cardWidth) / (count - 1);
}

/** 整手牌铺开后的总宽度 */
export function handWidth(
  count: number,
  railWidth = HAND_RAIL_WIDTH,
  cardWidth = HAND_CARD_WIDTH,
) {
  if (count <= 0) return 0;
  return count * cardWidth + (count - 1) * handSpacing(count, railWidth, cardWidth);
}

export interface HandCardLayout {
  /** 绕卡面下方支点的旋转角度 */
  rotate: number;
  /** 抛物线抬升，让扇形弧度更明显 */
  lift: number;
  zIndex: number;
}

/**
 * 单张牌的扇形姿态。
 * 张角和抬升都按张数归一化，牌多了不会把扇形甩成一个圈。
 */
export function handCardLayout(index: number, count: number): HandCardLayout {
  if (count <= 1) return { rotate: 0, lift: 0, zIndex: index };
  const mid = (count - 1) / 2;
  const norm = (index - mid) / mid; // -1（最左）..0（正中）..1（最右）
  const spread = Math.min(MAX_FAN_ANGLE, (count - 1) * 5);
  const liftMax = Math.min(MAX_LIFT, (count - 1) * 3);
  return {
    rotate: norm * (spread / 2),
    lift: norm ** 2 * liftMax,
    zIndex: index,
  };
}
