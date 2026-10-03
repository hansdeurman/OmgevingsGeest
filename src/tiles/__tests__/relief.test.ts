import { describe, expect, it } from 'vitest';
import { MAX_ELEVATION } from '../levels';
import {
  MOUNTAIN_FROM,
  blurHeights,
  lakeHeight,
  paintContours,
  shadeSlopes,
  sliceTerrain,
  terrainHeight,
  type Slice,
} from '../relief';
import { getPixel, paintRaster, setPixel, createRaster, type Raster } from '../raster';

const OPTS = { height: 40 };

describe('terrainHeight', () => {
  it('keeps the floor almost flat below the mountains', () => {
    expect(terrainHeight(0, 0.5, OPTS)).toBe(0);
    expect(terrainHeight(2, 0.5, OPTS)).toBeLessThanOrEqual(0.15 * OPTS.height);
    expect(terrainHeight(MOUNTAIN_FROM - 1, 1, OPTS)).toBeLessThanOrEqual(0.25 * OPTS.height);
  });

  it('reaches the full relief height at the highest elevation, and never far beyond it', () => {
    expect(terrainHeight(MAX_ELEVATION, 0.5, OPTS)).toBeCloseTo(OPTS.height, 6);
    expect(terrainHeight(MAX_ELEVATION, 1, OPTS)).toBeLessThanOrEqual(1.2 * OPTS.height);
    let prev = -1;
    for (let e = 0; e <= MAX_ELEVATION; e += 0.5) {
      const h = terrainHeight(e, 0.5, OPTS);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('puts a lake surface at or below the terrain of the same elevation, so rims rise above it', () => {
    for (let e = 0; e <= MAX_ELEVATION; e++) {
      for (const ridge of [0, 0.5, 1]) expect(lakeHeight(e, OPTS)).toBeLessThanOrEqual(terrainHeight(e, ridge, OPTS));
    }
  });
});

describe('blurHeights', () => {
  const W = 20;
  it('leaves an even surface untouched', () => {
    const h = new Float32Array(W * W).fill(7);
    blurHeights(h, W, W, 3);
    expect(h.every((v) => Math.abs(v - 7) < 1e-5)).toBe(true);
  });

  it('turns a sudden step into a gentle ramp', () => {
    const h = Float32Array.from({ length: W * W }, (_, i) => (i % W < W / 2 ? 0 : 1));
    blurHeights(h, W, W, 3);
    const row = Array.from({ length: W }, (_, x) => h[10 * W + x]);
    for (let x = 1; x < W; x++) expect(row[x] - row[x - 1]).toBeLessThan(0.3);
    expect(row[0]).toBeCloseTo(0, 6);
    expect(row[W - 1]).toBeCloseTo(1, 6);
  });

  it('is two box blurs of the given radius along each axis, borders clamped', () => {
    const [w, h] = [13, 9];
    const at = (a: ArrayLike<number>, x: number, y: number) => a[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const box = (a: ArrayLike<number>, dx: number, dy: number) =>
      Float32Array.from({ length: w * h }, (_, i) => {
        let sum = 0;
        for (let k = -2; k <= 2; k++) sum += at(a, (i % w) + k * dx, Math.floor(i / w) + k * dy);
        return sum / 5;
      });
    const start = Float32Array.from({ length: w * h }, (_, i) => Math.sin(i * 1.3) * 5 + (i % 7));
    let expected: Float32Array = start;
    for (let pass = 0; pass < 2; pass++) expected = box(box(expected, 1, 0), 0, 1);
    const got = start.slice();
    blurHeights(got, w, h, 2);
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });
});

describe('shadeSlopes', () => {
  const W = 9;
  const flatGrey = () => paintRaster(W, W, () => [100, 100, 100]);
  const ramp = (dir: 1 | -1) => Float32Array.from({ length: W * W }, (_, i) => (dir > 0 ? i % W : W - 1 - (i % W)) * 3);

  it('leaves flat ground unchanged', () => {
    const r = flatGrey();
    shadeSlopes(r, new Float32Array(W * W));
    expect(getPixel(r, 4, 4)).toEqual([100, 100, 100, 255]);
  });

  it('lights each pixel by the slope across its neighbours, as the plain formula does', () => {
    const heights = Float32Array.from({ length: W * W }, (_, i) => Math.sin(i * 0.7) * 4 + (i % W));
    const r = flatGrey();
    shadeSlopes(r, heights, 1.8);
    const h = (x: number, y: number) => heights[Math.min(W - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    const light = [-0.62, 0.22, 0.75].map((v, _, a) => v / Math.hypot(...a)); // from the left, a little from the front, above
    for (const [x, y] of [[0, 0], [4, 4], [8, 3], [2, 8]]) {
      const [hx, hy] = [(h(x + 1, y) - h(x - 1, y)) / 2, (h(x, y + 1) - h(x, y - 1)) / 2];
      const lit = (-hx * light[0] - hy * light[1] + light[2]) / Math.hypot(hx, hy, 1) / light[2];
      const k = Math.min(1.35, Math.max(0.55, 1 + (lit - 1) * 1.8));
      expect(getPixel(r, x, y)[0]).toBeCloseTo(Math.min(255, 100 * k), -0.5);
    }
  });

  it('lights slopes facing the light (left) and darkens those facing away', () => {
    const left = flatGrey();
    shadeSlopes(left, ramp(1)); // rises to the right: faces left
    const right = flatGrey();
    shadeSlopes(right, ramp(-1));
    expect(getPixel(left, 4, 4)[0]).toBeGreaterThan(100);
    expect(getPixel(right, 4, 4)[0]).toBeLessThan(100);
  });
});

describe('paintContours', () => {
  const W = 12;
  const grey = () => paintRaster(W, 4, () => [100, 100, 100]);
  /** Elevation rising one step every two pixels to the right. */
  const ramp = Float32Array.from({ length: W * 4 }, (_, i) => (i % W) / 2);

  it('draws a darker line where the ground crosses a whole step', () => {
    const g = grey();
    paintContours(g, ramp, 1);
    const xs = [...Array(W).keys()].filter((x) => getPixel(g, x, 1)[0] < 100);
    expect(xs).toEqual([1, 3, 5, 7, 9]); // just before each step up
  });

  it('draws nothing on level ground, such as a lake surface', () => {
    const g = grey();
    paintContours(g, new Float32Array(W * 4).fill(5.5), 1);
    expect(getPixel(g, 6, 2)[0]).toBe(100);
  });
});

describe('sliceTerrain', () => {
  const W = 6;
  const H = 10;
  const squash = 0.5;
  const ground = paintRaster(W, H, (_, y) => [y * 20, 0, 0]);
  const rows = Int16Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) < 5 ? 0 : 1));

  /** Paint slices in order, as the renderer does. */
  const composite = (slices: Slice[], height: number): Raster => {
    const out = createRaster(W, height);
    for (const s of slices) {
      for (let y = 0; y < s.raster.height; y++) {
        for (let x = 0; x < W; x++) {
          const p = getPixel(s.raster, x, y);
          const oy = s.top + y;
          if (p[3] && oy >= 0 && oy < height) setPixel(out, x, oy, [p[0], p[1], p[2]]);
        }
      }
    }
    return out;
  };

  it('lays flat ground out at its squashed position, one slice per hex row', () => {
    const slices = sliceTerrain(ground, new Float32Array(W * H), rows, squash);
    expect(slices.map((s) => s.index)).toEqual([0, 1]);
    const img = composite(slices, H * squash);
    expect(getPixel(img, 2, 4)[0]).toBe(180); // the front-most ground row covering screen row 4
    expect(getPixel(img, 2, 0)[3]).toBe(255);
  });

  it('raises a peak above the floor and lets nearer ground hide what lies behind', () => {
    const heights = new Float32Array(W * H);
    heights[2 * W + 2] = 4; // a pillar near the back
    const img = composite(sliceTerrain(ground, heights, rows, squash), H * squash);
    // The pillar's colour now reaches above its floor position.
    expect(getPixel(sliceTerrain(ground, heights, rows, squash)[0].raster, 2, 0)[3]).toBe(255);
    expect(sliceTerrain(ground, heights, rows, squash)[0].top).toBeLessThan(0);
    expect(getPixel(img, 2, 4)[0]).toBe(180);
  });

  it('paints a waterfall instead of rock where a raised edge is marked as falling water', () => {
    const red = paintRaster(W, H, () => [200, 0, 0]);
    const heights = new Float32Array(W * H);
    heights[(H - 1) * W + 3] = 3;
    const falls = new Uint8Array(W * H);
    falls[(H - 1) * W + 3] = 1;
    const dry = sliceTerrain(red, heights, rows, squash)[1];
    const wet = sliceTerrain(red, heights, rows, squash, { falls })[1];
    const y = Math.ceil(H * squash) - 1 - wet.top;
    expect(getPixel(dry.raster, 3, y)[0]).toBeGreaterThan(getPixel(dry.raster, 3, y)[2]);
    expect(getPixel(wet.raster, 3, y)[2]).toBeGreaterThan(getPixel(wet.raster, 3, y)[0]);
  });

  it('stretches the pool face over a raised pool\'s drop: its top at the rim, its bottom at the floor', () => {
    const face = createRaster(1, 2);
    setPixel(face, 0, 0, [250, 0, 0]);
    setPixel(face, 0, 1, [0, 0, 250]);
    const heights = new Float32Array(W * H);
    const pools = new Uint8Array(W * H);
    heights[(H - 1) * W + 3] = 4;
    pools[(H - 1) * W + 3] = 1;
    const front = sliceTerrain(ground, heights, rows, squash, { pool: face, pools })[1];
    const rim = Math.floor((H - 1) * squash - 4) - front.top;
    const floor = Math.ceil(H * squash) - 1 - front.top;
    expect(getPixel(front.raster, 3, rim + 1)[0]).toBe(250);
    expect(getPixel(front.raster, 3, floor)[2]).toBe(250);
  });

  it('extends a raised front edge down to the floor', () => {
    const heights = new Float32Array(W * H);
    heights[(H - 1) * W + 3] = 3;
    const front = sliceTerrain(ground, heights, rows, squash)[1];
    const floor = Math.ceil(H * squash) - 1 - front.top;
    expect(getPixel(front.raster, 3, floor)[3]).toBe(255);
  });
});
