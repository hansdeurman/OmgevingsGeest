import { describe, expect, it } from 'vitest';
import { MAX_ELEVATION } from '../levels';
import { MOUNTAIN_FROM, lakeHeight, shadeSlopes, sliceTerrain, terrainHeight, type Slice } from '../relief';
import { getPixel, paintRaster, setPixel, createRaster, type Raster } from '../raster';

const OPTS = { mountain: 100, hill: 2 };

describe('terrainHeight', () => {
  it('keeps the floor almost flat below the mountains', () => {
    expect(terrainHeight(0, 0.5, OPTS)).toBe(0);
    expect(terrainHeight(2, 0.5, OPTS)).toBe(4);
    expect(terrainHeight(MOUNTAIN_FROM - 1, 1, OPTS)).toBeLessThan(10);
  });

  it('rises steeply once the land becomes mountain', () => {
    expect(terrainHeight(MAX_ELEVATION, 0.5, OPTS)).toBeGreaterThan(80);
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

describe('shadeSlopes', () => {
  const W = 9;
  const flatGrey = () => paintRaster(W, W, () => [100, 100, 100]);
  const ramp = (dir: 1 | -1) => Float32Array.from({ length: W * W }, (_, i) => (dir > 0 ? i % W : W - 1 - (i % W)) * 3);

  it('leaves flat ground unchanged', () => {
    const r = flatGrey();
    shadeSlopes(r, new Float32Array(W * W));
    expect(getPixel(r, 4, 4)).toEqual([100, 100, 100, 255]);
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
    expect(slices.map((s) => s.row)).toEqual([0, 1]);
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

  it('extends a raised front edge down to the floor', () => {
    const heights = new Float32Array(W * H);
    heights[(H - 1) * W + 3] = 3;
    const front = sliceTerrain(ground, heights, rows, squash)[1];
    const floor = Math.ceil(H * squash) - 1 - front.top;
    expect(getPixel(front.raster, 3, floor)[3]).toBe(255);
  });
});
