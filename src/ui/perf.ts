/** Entries kept per label: enough to read recent timings, never a growing pile. */
const KEEP = 200;

/**
 * Run `f`, recording how long it took as a performance measure named
 * `label`, so the browser's performance timeline (and tests driving the
 * page) can read what each part of a frame costs.
 */
export function timed<T>(label: string, f: () => T): T {
  const start = performance.now();
  try {
    return f();
  } finally {
    performance.measure(label, { start, end: performance.now() });
    if (performance.getEntriesByName(label, 'measure').length > KEEP) performance.clearMeasures(label);
  }
}
