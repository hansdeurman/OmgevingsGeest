import { describe, expect, it } from 'vitest';
import { hexTopology, opposite, pipeTarget } from '../../water/hexTopology';
import { frameCentre, gridFrame } from '../geometry';
import { riverSegments } from '../riverLayer';

const [COLS, ROWS, SIZE] = [6, 5, 10];
const topo = hexTopology(COLS, ROWS, 12);
const frame = gridFrame(COLS, ROWS, SIZE);
const flowing = (pipes: [number, number, number][]) => {
  const flux = new Float32Array(COLS * ROWS * 12);
  for (const [i, d, f] of pipes) flux[i * 12 + d] = f;
  return flux;
};
const centre = (i: number) => frameCentre(i % COLS, Math.floor(i / COLS), SIZE, frame);
const between = (i: number, j: number) => ({ x: (centre(i).x + centre(j).x) / 2, y: (centre(i).y + centre(j).y) / 2 });
const none = new Float32Array(COLS * ROWS);
const MIDDLE = 2 * COLS + 2;
const segs = (pipes: [number, number, number][], depth = none) => riverSegments(topo, flowing(pipes), depth, frame, SIZE);

describe('riverSegments', () => {
  it('runs a river through each hex it passes, curving through its middle, the hexes meeting halfway', () => {
    const j = pipeTarget(topo, MIDDLE, 0);
    const k = pipeTarget(topo, j, 1);
    const river = segs([[MIDDLE, 0, 0.05], [j, 1, 0.05]]);
    const inJ = river.find((s) => s.via.x === centre(j).x && s.via.y === centre(j).y)!;
    expect(inJ.from).toEqual(between(MIDDLE, j));
    expect(inJ.to).toEqual(between(j, k));
    const source = river.find((s) => s.via.x === centre(MIDDLE).x)!;
    expect(source.from).toEqual(centre(MIDDLE)); // where it springs, it starts in the middle
    expect(source.to).toEqual(inJ.from);
  });

  it('ends a river in the middle of the hex it runs into', () => {
    const j = pipeTarget(topo, MIDDLE, 8);
    const end = segs([[MIDDLE, 8, 0.05]]).find((s) => s.via.x === centre(j).x && s.via.y === centre(j).y)!;
    expect(end.to).toEqual(centre(j));
  });

  it('is wider the more water it carries', () => {
    const width = (f: number) => Math.max(...segs([[MIDDLE, 0, f]]).map((s) => s.width));
    expect(width(0.3)).toBeGreaterThan(width(0.03));
  });

  it('draws only the net flow, and nothing for a trickle', () => {
    const j = pipeTarget(topo, MIDDLE, 1);
    expect(segs([[MIDDLE, 1, 0.1], [j, opposite(1), 0.1]])).toEqual([]);
    expect(segs([[MIDDLE, 1, 0.001]])).toEqual([]);
  });

  it('draws water spreading over many pipes as one river along its main ways', () => {
    const out = segs([[MIDDLE, 0, 0.06], [MIDDLE, 6, 0.05], [MIDDLE, 5, 0.01], [MIDDLE, 11, 0.008]]).filter((s) => s.via.x === centre(MIDDLE).x && s.via.y === centre(MIDDLE).y);
    expect(out).toHaveLength(2); // the two big branches, not the trickles beside them
  });

  it('draws no river where water runs off a slope as a broad sheet: only where it gathers', () => {
    const sheet: [number, number, number][] = [];
    for (let i = 0; i < COLS * ROWS; i++) if (pipeTarget(topo, i, 0) >= 0) sheet.push([i, 0, 0.02]);
    expect(segs(sheet)).toEqual([]);
  });

  it('keeps a river going downstream where it thins out, instead of breaking off', () => {
    const [a, b] = [MIDDLE, pipeTarget(topo, MIDDLE, 0)];
    const c = pipeTarget(topo, b, 0);
    const thinning = segs([[a, 0, 0.05], [b, 0, 0.004], [c, 0, 0.004]]);
    expect(thinning.some((s) => s.via.x === centre(c).x && s.via.y === centre(c).y)).toBe(true);
  });

  it('tells how deep the river has cut into its hex, so its gully can show', () => {
    const cut = new Float32Array(COLS * ROWS);
    cut[MIDDLE] = 0.4;
    const river = riverSegments(topo, flowing([[MIDDLE, 0, 0.05]]), none, frame, SIZE, cut);
    expect(river.find((s) => s.via.x === centre(MIDDLE).x && s.via.y === centre(MIDDLE).y)!.cut).toBeCloseTo(0.4, 6);
    expect(segs([[MIDDLE, 0, 0.05]]).every((s) => s.cut === 0)).toBe(true);
  });

  it('leaves out water moving about inside a lake: the lake is drawn by itself', () => {
    expect(segs([[MIDDLE, 0, 0.2]], Float32Array.from({ length: COLS * ROWS }, () => 1))).toEqual([]);
  });
});
