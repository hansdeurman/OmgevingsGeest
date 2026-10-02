import { describe, expect, it } from 'vitest';
import { blendField, hexBlend, sampleField } from '../hexField';
import { frameCentre, gridFrame } from '../geometry';

const SIZE = 20;
const [cols, rows] = [6, 5];
const frame = gridFrame(cols, rows, SIZE);
const blend = hexBlend(cols, rows, frame, SIZE);
/** One hex at `value`, all others 0. */
const single = (i: number, value = 1) => Float32Array.from({ length: cols * rows }, (_, k) => (k === i ? value : 0));

describe('hex fields', () => {
  it('stays near a hex its own value at its middle', () => {
    const i = 2 * cols + 2;
    const c = frameCentre(2, 2, SIZE, frame);
    expect(sampleField(blend, blendField(blend, single(i)), c.x, c.y)).toBeGreaterThan(0.8);
  });

  it('meets a neighbour halfway on their shared edge, and runs smoothly in between', () => {
    const [a, b] = [frameCentre(2, 2, SIZE, frame), frameCentre(3, 2, SIZE, frame)];
    const field = blendField(blend, single(2 * cols + 2));
    const at = (t: number) => sampleField(blend, field, a.x + (b.x - a.x) * t, a.y);
    expect(at(0.5)).toBeGreaterThan(0.35);
    expect(at(0.5)).toBeLessThan(0.65);
    for (let k = 1; k <= 20; k++) expect(at(k / 20)).toBeLessThanOrEqual(at((k - 1) / 20) + 0.01);
  });

  it('gives an even field its value everywhere on the map', () => {
    const field = blendField(blend, new Float32Array(cols * rows).fill(3));
    for (let y = 0; y < frame.height; y += 7) for (let x = 0; x < frame.width; x += 7) expect(sampleField(blend, field, x, y)).toBeCloseTo(3, 4);
  });

  it('reuses its buffer', () => {
    const out = new Float32Array(blend.gw * blend.gh);
    expect(blendField(blend, single(0), out)).toBe(out);
  });
});
