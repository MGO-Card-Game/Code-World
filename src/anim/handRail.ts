/**
 * 手牌浏览栏的几何计算。
 *
 * 和战斗台的扇形（handLayout.ts）分开算，因为两处要解决的问题不同：战斗台是「打牌」，
 * 牌少、整张牌就是按钮，重叠和旋转都不妨碍点击；资源弹窗是「翻背包」，要逐张看清，
 * 所以只做水平排布，收紧到看不清就改成横向滚动，绝不把卡压成细条。
 */

/** 单张卡面宽度，与 styles.css 的 .hand-card 保持一致 */
export const RAIL_CARD_WIDTH = 96;
/** 手牌栏可用宽度：.resource-modal 宽 720 减去左右各 32 内边距 */
export const RAIL_WIDTH = 656;

/** 排得下时卡牌之间的留白 */
const RELAXED_GAP = 10;
/**
 * 重叠时每张至少露出的宽度。
 *
 * 这是硬下限，不是期望值——够看清类型徽记和牌名头两个字就行，再窄一张牌就退化成
 * 一根无法辨认的竖条。收到下限还排不下时改用横向滚动，而不是继续压缩。
 */
export const RAIL_MIN_VISIBLE = 56;

export interface RailMetrics {
  /** 相邻两张牌之间的间距（作为 marginLeft），负值表示重叠 */
  spacing: number;
  /** 收紧到下限仍排不下，手牌栏需要横向滚动 */
  scrollable: boolean;
  /** 整排铺开后的实际宽度 */
  width: number;
}

export function railMetrics(
  count: number,
  railWidth = RAIL_WIDTH,
  cardWidth = RAIL_CARD_WIDTH,
): RailMetrics {
  if (count <= 1) {
    return { spacing: 0, scrollable: false, width: Math.max(0, count) * cardWidth };
  }
  const relaxedWidth = count * cardWidth + (count - 1) * RELAXED_GAP;
  if (relaxedWidth <= railWidth) {
    return { spacing: RELAXED_GAP, scrollable: false, width: relaxedWidth };
  }
  const fitted = (railWidth - count * cardWidth) / (count - 1);
  const spacing = Math.max(fitted, RAIL_MIN_VISIBLE - cardWidth);
  const width = count * cardWidth + (count - 1) * spacing;
  return { spacing, scrollable: width > railWidth + 0.001, width };
}

/**
 * 选中的那张要完整露出来，左右各让开被邻牌压住的部分。
 * 不重叠时无需让位，返回 0。
 */
export function railSelectionGap(spacing: number) {
  return spacing < 0 ? -spacing : 0;
}
