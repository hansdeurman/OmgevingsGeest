import { describe, expect, it } from 'vitest';
import { drawArea, type AreaCanvas } from '../areaLayer';

/** A canvas that writes down what is drawn on it. */
const recorder = () => {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: () => calls.push('begin'),
    moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
    closePath: () => calls.push('close'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    setLineDash: (d: number[]) => calls.push(`dash ${d.length}`),
  };
  return { ctx: ctx as unknown as AreaCanvas, calls };
};
const double = (x: number, y: number) => ({ x: 2 * x, y: 2 * y });

describe('drawArea', () => {
  it('draws an area being drawn as an open dashed line, on the screen', () => {
    const { ctx, calls } = recorder();
    drawArea(ctx, [{ x: 1, y: 1 }, { x: 2, y: 1 }], double, false);
    expect(calls).toEqual(['begin', 'move 2,2', 'line 4,2', 'dash 2', 'stroke', 'dash 0']);
  });

  it('closes and fills a chosen area', () => {
    const { ctx, calls } = recorder();
    drawArea(ctx, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], double, true);
    expect(calls).toContain('close');
    expect(calls).toContain('fill');
  });

  it('draws nothing for a single point', () => {
    const { ctx, calls } = recorder();
    drawArea(ctx, [{ x: 1, y: 1 }], double, true);
    expect(calls).toEqual([]);
  });
});
