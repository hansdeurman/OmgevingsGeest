export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One scale factor for all variants of a prop kind: the median variant lands
 * on `target` height, and bigger or smaller variants keep their proportions.
 */
export function scaleToMedian(heights: readonly number[], target: number): number {
  return target / median(heights);
}
