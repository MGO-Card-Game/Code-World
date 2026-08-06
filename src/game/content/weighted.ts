/**
 * 按正权重抽取一项，只消耗一个随机数。
 *
 * 地图、怪物与事件都依赖种子重放；把实现收在一处，避免不同内容池在边界处理和
 * 随机数消耗数量上悄悄分叉。
 */
export function pickWeighted<T>(
  entries: readonly (readonly [T, number])[],
  random: () => number,
): T {
  if (entries.length === 0) throw new Error("不能从空权重池抽取内容");
  if (entries.some(([, weight]) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error("权重池只能包含有限的正权重");
  }

  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let ticket = Math.min(0.999999999, Math.max(0, random())) * total;
  for (const [item, weight] of entries) {
    ticket -= weight;
    if (ticket < 0) return item;
  }
  return entries.at(-1)![0];
}
