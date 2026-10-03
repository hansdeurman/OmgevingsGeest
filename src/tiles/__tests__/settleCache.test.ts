import { describe, expect, it } from 'vitest';
import { createSettleCache } from '../settleCache';

describe('createSettleCache', () => {
  const counting = () => {
    let made = 0;
    const cache = createSettleCache<string, number>(0.05);
    const get = (key: string, values: number[], tag = '') => cache(key, values, tag, () => ++made);
    return { get, made: () => made };
  };

  it('keeps what it made while the values it was made for barely change', () => {
    const c = counting();
    expect(c.get('a', [1, 2])).toBe(1);
    expect(c.get('a', [1.03, 1.97])).toBe(1);
    expect(c.made()).toBe(1);
  });

  it('makes it anew once a value has moved more than the tolerance since it was made', () => {
    const c = counting();
    c.get('a', [1, 2]);
    c.get('a', [1.04, 2]);
    expect(c.get('a', [1.08, 2])).toBe(2); // drifting slowly still adds up
  });

  it('makes it anew when its tag changes or the number of values does', () => {
    const c = counting();
    c.get('a', [1], 'calm');
    expect(c.get('a', [1], 'windy')).toBe(2);
    expect(c.get('a', [1, 1], 'windy')).toBe(3);
  });

  it('keeps one thing per key', () => {
    const c = counting();
    c.get('a', [1]);
    c.get('b', [1]);
    expect(c.get('a', [1])).toBe(1);
    expect(c.made()).toBe(2);
  });
});
