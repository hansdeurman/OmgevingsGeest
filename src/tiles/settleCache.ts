/**
 * Keeps something costly to make (a painted lake) for as long as the values
 * it was made from (the water in its basin) stay within `tolerance` of what
 * they were then, and its `tag` (the weather) stays the same. Compared with
 * when it was made, not with the last call, so slow drift still adds up.
 */
export function createSettleCache<K, V>(tolerance: number) {
  const entries = new Map<K, { values: Float32Array; tag: string; value: V }>();
  return (key: K, values: ArrayLike<number>, tag: string, make: () => V): V => {
    const was = entries.get(key);
    if (was && was.tag === tag && was.values.length === values.length && withinOf(was.values, values, tolerance)) return was.value;
    const value = make();
    entries.set(key, { values: Float32Array.from(values), tag, value });
    return value;
  };
}

function withinOf(a: ArrayLike<number>, b: ArrayLike<number>, tolerance: number): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance) return false;
  return true;
}
