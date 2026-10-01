import { describe, expect, it } from 'vitest';
import { carveChannel, fallLips, fillPoolHoles, growPlateau, markFalls, paintPoolRims, paintSplash, shadePoolFoot, tidyPool } from '../pools';
import { getPixel, paintRaster } from '../raster';

const W = 12;
/** A pool raised 5px over the square 3..8. */
const inSquare = (i: number) => i % W >= 3 && i % W <= 8 && Math.floor(i / W) >= 3 && Math.floor(i / W) <= 8;
const squarePool = () => Uint8Array.from({ length: W * W }, (_, i) => (inSquare(i) ? 1 : 0));
const raise = (pool: Uint8Array) => Float32Array.from(pool, (p) => p * 5);

describe('fillPoolHoles', () => {
  it('raises dry pockets enclosed by raised water to the water level', () => {
    const pool = squarePool();
    const heights = raise(pool);
    pool[5 * W + 5] = 0;
    heights[5 * W + 5] = 0;
    fillPoolHoles(pool, heights, W, W);
    expect(pool[5 * W + 5]).toBe(1);
    expect(heights[5 * W + 5]).toBe(5);
  });

  it('leaves land that reaches the open map alone, and never lowers ground', () => {
    const pool = squarePool();
    const heights = raise(pool);
    pool[5 * W + 3] = 0; // a bay open to the outside
    heights[5 * W + 3] = 0;
    heights[0] = 9;
    fillPoolHoles(pool, heights, W, W);
    expect(pool[5 * W + 3]).toBe(0);
    expect(heights[0]).toBe(9);
  });
});

describe('growPlateau', () => {
  // Lake (square 3..8) at elevation 6, raised 5px; land to its right (x ≥ 9) at 6.5, the rest at 2.
  const setup = () => {
    const raised = squarePool();
    const heights = raise(raised);
    const level = Float32Array.from(raised, (p) => (p ? 6 : 0));
    const alt = Float32Array.from({ length: W * W }, (_, i) => (inSquare(i) ? 6 : i % W >= 9 ? 6.5 : 2));
    growPlateau(raised, heights, level, alt, W, W, 0.5);
    return { raised, heights };
  };

  it('lifts land at or above the lake level, touching the lake, to the water height', () => {
    const { raised, heights } = setup();
    expect(raised[5 * W + 10]).toBe(1);
    expect(heights[5 * W + 10]).toBe(5);
    expect(raised[0 * W + 11]).toBe(1); // reached through the high land, not only next to the water
  });

  it('leaves lower land on the floor', () => {
    const { raised, heights } = setup();
    expect(raised[5 * W + 1]).toBe(0);
    expect(heights[5 * W + 1]).toBe(0);
  });
});

describe('carveChannel', () => {
  // Plateau x 3..10, rows 3..8; water only in x 3..6: dry plateau between the water and a lip at (10, 5).
  const raised = Uint8Array.from({ length: W * W }, (_, i) => (i % W >= 3 && i % W <= 10 && Math.floor(i / W) >= 3 && Math.floor(i / W) <= 8 ? 1 : 0));
  const water = () => Uint8Array.from(raised, (r, i) => (r && i % W <= 6 ? 1 : 0));

  it('runs water across the plateau from the lake to the lip', () => {
    const w = water();
    const wet = carveChannel(w, raised, W, W, { x: 10.5, y: 5.5 }, 2);
    for (let x = 7; x <= 10; x++) expect(w[5 * W + x]).toBe(1);
    expect(wet.get(5 * W + 8)).toBeGreaterThan(0.8); // on the centre line
    expect(wet.get(4 * W + 8)).toBeLessThan(wet.get(5 * W + 8)!); // toward the bank
    expect(w[3 * W + 9]).toBe(0); // narrow: not the whole plateau
  });

  it('never makes water outside the plateau', () => {
    const w = water();
    carveChannel(w, raised, W, W, { x: 10.5, y: 5.5 }, 4);
    w.forEach((v, i) => v && expect(raised[i]).toBe(1));
  });
});

describe('tidyPool', () => {
  it('drops raised specks too small to read as a lake, back to the floor', () => {
    const pool = squarePool();
    const heights = raise(pool);
    pool[1 * W + 10] = 1;
    heights[1 * W + 10] = 5;
    tidyPool(pool, heights, W, W, 1, 4);
    expect(pool[1 * W + 10]).toBe(0);
    expect(heights[1 * W + 10]).toBe(0);
    expect(pool[5 * W + 5]).toBe(1);
  });

  it('smooths a ragged edge: a one-pixel spike goes, a one-pixel notch fills at the water level', () => {
    const pool = squarePool();
    const heights = raise(pool);
    pool[5 * W + 9] = 1; // spike out of the right edge
    heights[5 * W + 9] = 5;
    pool[3 * W + 5] = 0; // notch into the top edge
    heights[3 * W + 5] = 0;
    tidyPool(pool, heights, W, W, 1, 4);
    expect(pool[5 * W + 9]).toBe(0);
    expect(heights[5 * W + 9]).toBe(0);
    expect(pool[3 * W + 5]).toBe(1);
    expect(heights[3 * W + 5]).toBe(5);
  });
});

describe('fallLips', () => {
  it('finds the pool pixel nearest each outlet', () => {
    expect(fallLips(squarePool(), W, [{ x: 5.5, y: 30 }])).toEqual([{ x: 5.5, y: 8.5 }]);
  });

  it('finds none without a pool', () => {
    expect(fallLips(new Uint8Array(W * W), W, [{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe('shadePoolFoot', () => {
  const grey = () => paintRaster(W, W, () => [100, 100, 100]);

  it('darkens the ground right in front of (below) a pool, fading with distance', () => {
    const g = grey();
    shadePoolFoot(g, squarePool(), 3);
    const near = getPixel(g, 5, 9)[0];
    const far = getPixel(g, 5, 11)[0];
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThanOrEqual(100);
  });

  it('leaves the pool, the ground behind it and the ground beside it alone', () => {
    const g = grey();
    shadePoolFoot(g, squarePool(), 3);
    expect(getPixel(g, 5, 5)[0]).toBe(100);
    expect(getPixel(g, 5, 1)[0]).toBe(100);
    expect(getPixel(g, 0, 5)[0]).toBe(100);
  });
});

describe('markFalls', () => {
  it('marks the pool pixels around each lip, and nothing far from it or outside the pool', () => {
    const falls = markFalls(squarePool(), W, W, [{ x: 8.5, y: 5.5 }], 1.5);
    const marked = [...falls.keys()].filter((i) => falls[i]);
    expect(falls[5 * W + 8]).toBe(1);
    expect(marked.every((i) => inSquare(i) && i % W >= 7 && Math.abs(Math.floor(i / W) - 5) <= 1)).toBe(true);
  });

  it('marks nothing without lips', () => {
    expect(markFalls(squarePool(), W, W, [], 2).some(Boolean)).toBe(false);
  });
});

describe('paintSplash', () => {
  const sand = () => paintRaster(W, W, () => [220, 190, 120]);
  const pool = squarePool();
  const falls = new Uint8Array(W * W);
  falls[8 * W + 5] = 1; // pours over the front (bottom) edge

  it('foams up the land right at the foot of a waterfall', () => {
    const g = sand();
    paintSplash(g, pool, falls, 2);
    const [r, , b] = getPixel(g, 5, 9);
    expect(b).toBeGreaterThan(r);
  });

  it('leaves the pool itself and land away from the fall untouched', () => {
    const g = sand();
    paintSplash(g, pool, falls, 2);
    expect(getPixel(g, 5, 7)).toEqual([220, 190, 120, 255]);
    expect(getPixel(g, 1, 1)).toEqual([220, 190, 120, 255]);
  });
});

describe('paintPoolRims', () => {
  const blue = () => paintRaster(W, W, () => [40, 120, 220]);
  const pool = squarePool();
  const heights = raise(pool);
  const falls = new Uint8Array(W * W);
  falls[5 * W + 8] = 1;

  it('rings raised water with a stone lip and leaves its middle and the land alone', () => {
    const g = blue();
    paintPoolRims(g, heights, pool, falls, 1);
    const [r, , b] = getPixel(g, 3, 5);
    expect(r).toBeGreaterThan(b); // stone, not water
    expect(getPixel(g, 5, 5)).toEqual([40, 120, 220, 255]);
    expect(getPixel(g, 1, 5)).toEqual([40, 120, 220, 255]);
  });

  it('turns the lip to foam where the water pours over', () => {
    const g = blue();
    paintPoolRims(g, heights, pool, falls, 1);
    expect(Math.min(...getPixel(g, 8, 5).slice(0, 3))).toBeGreaterThan(230);
  });

  it('paints no lip where the water is not raised', () => {
    const g = blue();
    paintPoolRims(g, new Float32Array(W * W), pool, falls, 1);
    expect(getPixel(g, 3, 5)).toEqual([40, 120, 220, 255]);
  });
});
