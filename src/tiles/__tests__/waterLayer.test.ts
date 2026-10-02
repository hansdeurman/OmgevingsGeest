import { describe, expect, it } from 'vitest';
import { offsetNeighbours } from '../../math/hex';
import { frameCentre, gridFrame } from '../geometry';
import { basinWater, findBasins, fullOutflow, lakeOutflow, lakesIn, settleProps, type CellWater } from '../waterLayer';
import { ISLAND, LAND, WATER, type LakeSurface } from '../lakePainter';
import { hexTopology, pipeTarget } from '../../water/hexTopology';
import type { PropInstance } from '../scatter';

const SIZE = 12;
const N = 7;
const frame = gridFrame(N, N, SIZE);
const SQUASH = 0.6;
const index = (col: number, row: number) => row * N + col;
const MIDDLE = index(3, 3);
const ring = offsetNeighbours(3).map((d) => index(3 + d.dc, 3 + d.dr));
const basinCells = [MIDDLE, ...ring];
/** Ground: high all round, the basin's cells lower; `middle` is the centre cell's ground. */
const groundWith = (middle: number, around = 2) => Array.from({ length: N * N }, (_, i) => (i === MIDDLE ? middle : ring.includes(i) ? around : 6));
const cells = (ground: number[], depth: (i: number) => number): CellWater => ({ cols: N, rows: N, ground, depth: ground.map((_, i) => depth(i)) });
const centre = (i: number) => frameCentre(i % N, Math.floor(i / N), SIZE, frame);
const [basin] = findBasins({ cols: N, rows: N, elevation: groundWith(1.5) }, groundWith(1.5).map((g, i) => (basinCells.includes(i) ? 3.5 - g : 0)), [], frame, SIZE);
const lakes = (water: CellWater) => lakesIn(basin, water, frame, SIZE);

describe('findBasins', () => {
  it('finds each basin with the level at which it overflows and a box around its cells', () => {
    expect(basin.cells.sort((a, b) => a - b)).toEqual([...basinCells].sort((a, b) => a - b));
    expect(basin.full).toBeCloseTo(3.5, 6);
    const c = centre(MIDDLE);
    expect(c.x).toBeGreaterThan(basin.box.x0);
    expect(c.x).toBeLessThan(basin.box.x1);
  });

  it('knows where a basin pours out, from the river that leaves it', () => {
    const river = { cells: [MIDDLE, ring[0], 0], cascades: [], outlet: [ring[0], 0] as [number, number] };
    const [withOutlet] = findBasins({ cols: N, rows: N, elevation: groundWith(1.5) }, groundWith(1.5).map((g, i) => (basinCells.includes(i) ? 3.5 - g : 0)), [river], frame, SIZE);
    const [a, b] = [centre(MIDDLE), centre(0)];
    expect(withOutlet.outlet).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
});

describe('basinWater', () => {
  const at = (w: ReturnType<typeof basinWater>, i: number) => {
    const c = centre(i);
    return (Math.floor(c.y) - basin.box.y0) * w.width + Math.floor(c.x) - basin.box.x0;
  };

  it('stands the water at its level wherever that is above the ground', () => {
    const w = basinWater(basin, cells(groundWith(1.5), (i) => (basinCells.includes(i) ? 3.5 - groundWith(1.5)[i] : 0)), frame, SIZE);
    expect(w.levels[at(w, MIDDLE)]).toBeCloseTo(3.5, 3);
    expect(w.ground[at(w, MIDDLE)]).toBeCloseTo(1.5, 1);
  });

  it('runs the shore up the slope of the land around the basin, not along its hex edges', () => {
    // Ground just above the full level around the basin: the shore lies past the basin's cells.
    const ground = Array.from({ length: N * N }, (_, i) => (basinCells.includes(i) ? 2 : 3.8));
    const [b] = findBasins({ cols: N, rows: N, elevation: ground }, ground.map((g, i) => (basinCells.includes(i) ? 3.5 - g : 0)), [], frame, SIZE);
    const w = basinWater(b, cells(ground, (i) => (basinCells.includes(i) ? 1.5 : 0)), frame, SIZE);
    const outer = index(3, 0); // two rows up: not a neighbour of the basin
    const [a, c] = [centre(ring.find((i) => Math.floor(i / N) === 2)!), centre(index(3, 1))];
    const past = { x: Math.floor(a.x + (c.x - a.x) * 0.6), y: Math.floor(a.y + (c.y - a.y) * 0.6) }; // just past the edge, in the land around
    expect(Number.isNaN(w.levels[(past.y - b.box.y0) * w.width + past.x - b.box.x0])).toBe(false);
    expect(b.cells.includes(outer)).toBe(false);
  });

  it('never lets the water over the crest of the land around it, into the low land beyond', () => {
    // Land around the basin just above the full level, the land beyond it far below.
    const ring2 = Array.from({ length: N * N }, (_, i) => i).filter((i) => !basinCells.includes(i));
    const ground = Array.from({ length: N * N }, (_, i) => (basinCells.includes(i) ? 2 : ring2.includes(i) && Math.abs((i % N) - 3) <= 2 && Math.abs(Math.floor(i / N) - 3) <= 2 ? 3.6 : 0.5));
    const [b] = findBasins({ cols: N, rows: N, elevation: ground }, ground.map((g, i) => (basinCells.includes(i) ? 3.5 - g : 0)), [], frame, SIZE);
    const w = basinWater(b, cells(ground, (i) => (basinCells.includes(i) ? 1.5 : 0)), frame, SIZE);
    const wet = [...w.levels.keys()].filter((i) => !Number.isNaN(w.levels[i]));
    const far = wet.filter((i) => {
      const [x, y] = [b.box.x0 + (i % w.width), b.box.y0 + Math.floor(i / w.width)];
      return Math.min(...basinCells.map((c) => Math.hypot(centre(c).x - x, centre(c).y - y))) > 1.5 * SIZE;
    });
    expect(wet.length).toBeGreaterThan(0);
    expect(far).toEqual([]);
  });

  it('keeps a little water in the deepest spot, the rest of the basin dry', () => {
    const w = basinWater(basin, cells(groundWith(1.5), (i) => (i === MIDDLE ? 0.3 : 0)), frame, SIZE);
    expect(w.levels[at(w, MIDDLE)]).toBeCloseTo(1.8, 2);
    expect(Number.isNaN(w.levels[at(w, ring[0])])).toBe(true);
  });
});

describe('lakesIn', () => {
  it('draws nothing in an empty basin: it is just land', () => {
    expect(lakes(cells(groundWith(1.5), () => 0))).toEqual([]);
  });

  it('lets a peak poke through the water as an island', () => {
    const ground = groundWith(4.5);
    const [lake] = lakes(cells(ground, (i) => (ring.includes(i) ? 1 : 0)));
    const c = centre(MIDDLE);
    expect(lake.shape.mask[(Math.floor(c.y) - lake.shape.y0) * lake.shape.width + Math.floor(c.x) - lake.shape.x0]).toBe(2);
  });

  it('keeps an uneven lake uneven: the side with more water stands higher', () => {
    const ground = groundWith(2);
    const west = (i: number) => i % N < 3;
    const [lake] = lakes(cells(ground, (i) => (basinCells.includes(i) ? (west(i) ? 2 : 1) : 0)));
    const levelAt = (i: number) => {
      const c = centre(i);
      return lake.shape.levels[(Math.floor(c.y) - lake.shape.y0) * lake.shape.width + Math.floor(c.x) - lake.shape.x0];
    };
    expect(levelAt(index(2, 3))).toBeGreaterThan(levelAt(index(4, 3)) + 0.5);
  });

  it('draws no lake on the land around a basin: water standing only there runs off', () => {
    const ground = groundWith(2, 2).map((g, i) => (basinCells.includes(i) ? g : 3.5));
    const shoreOnly = (i: number) => (!basinCells.includes(i) && Math.floor(i / N) <= 1 ? 0.5 : 0);
    const [b] = findBasins({ cols: N, rows: N, elevation: ground }, ground.map((g, i) => (basinCells.includes(i) ? 3.5 - g : 0)), [], frame, SIZE);
    expect(lakesIn(b, cells(ground, shoreOnly), frame, SIZE)).toEqual([]);
  });

  it('tells each lake the basin it lies in', () => {
    const [lake] = lakes(cells(groundWith(1.5), (i) => (basinCells.includes(i) ? 3.5 - groundWith(1.5)[i] : 0)));
    expect(lake.basin).toBe(basin);
  });
});

describe('lakeOutflow', () => {
  const [lake] = lakes(cells(groundWith(1.5), (i) => (basinCells.includes(i) ? 3.5 - groundWith(1.5)[i] : 0)));
  const topo = hexTopology(N, N, 12);
  const flux = new Float32Array(N * N * 12);
  const out = (i: number, d: number, f: number) => (flux[i * 12 + d] = f);

  it('counts the water leaving the lake, and where most of it leaves', () => {
    const edge = ring[0];
    const d = Array.from({ length: 12 }, (_, k) => k).find((k) => { const j = pipeTarget(topo, edge, k); return j >= 0 && !basinCells.includes(j); })!;
    out(edge, d, 0.04);
    out(MIDDLE, 0, 0.5); // inside the lake: not leaving it
    const o = lakeOutflow(lake.shape, topo, flux, frame, SIZE);
    expect(o.amount).toBeCloseTo(0.04, 6);
    const [a, b] = [centre(edge), centre(pipeTarget(topo, edge, d))];
    expect(o.at).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
});

describe('fullOutflow', () => {
  it('pours out of a full basin where its river leaves, and not out of one below its overflow', () => {
    const [full] = lakes(cells(groundWith(1.5), (i) => (basinCells.includes(i) ? 3.5 - groundWith(1.5)[i] : 0)));
    const withOutlet = { ...basin, outlet: { x: 1, y: 2 } };
    expect(fullOutflow(full.shape, withOutlet).at).toEqual({ x: 1, y: 2 });
    expect(fullOutflow({ ...full.shape, top: 2 }, withOutlet).amount).toBe(0);
  });
});

describe('settleProps', () => {
  /** A surface 10x10 at (100, 100): water at level 3 raised 20 px on its left half, land raised 8 px on its right half, an island at (102, 105). */
  const surface: LakeSurface = {
    x0: 100,
    y0: 100,
    width: 10,
    height: 10,
    lift: Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 20 : 8)),
    kind: Uint8Array.from({ length: 100 }, (_, i) => (i === 52 ? ISLAND : i % 10 < 5 ? WATER : LAND)),
    level: Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 3 : NaN)),
  };
  const prop = (x: number, y: number, extra: Partial<PropInstance> = {}): PropInstance => ({ kind: 'peak', variant: 0, x, y: y * SQUASH, col: 0, row: 0, ...extra });

  it('stands a peak taller than the water on it, lifted to the water\'s height', () => {
    const peak = prop(101, 101, { elevation: 4.5 });
    const { kept, riders } = settleProps([peak], [surface], SQUASH);
    expect(kept).toEqual([]);
    expect(riders[0][0].y).toBeCloseTo(peak.y - 20, 6);
  });

  it('hides what the water covers: low hills and trees', () => {
    const { kept, riders } = settleProps([prop(101, 101, { kind: 'hill', elevation: 2 }), prop(102, 103, { kind: 'tree' })], [surface], SQUASH);
    expect(kept).toEqual([]);
    expect(riders[0]).toEqual([]);
  });

  it('stands what is on an island or on the lake\'s flank on it, at its height there', () => {
    const { riders } = settleProps([prop(102, 105, { kind: 'tree' }), prop(107, 103, { kind: 'tree' })], [surface], SQUASH);
    expect(riders[0].map((r) => r.y)).toEqual([105 * SQUASH - 20, 103 * SQUASH - 8]);
  });

  it('leaves everything away from the lake as it was', () => {
    const far = prop(10, 10, { elevation: 6 });
    expect(settleProps([far], [surface], SQUASH).kept).toEqual([far]);
  });
});
