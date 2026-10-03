import { describe, expect, it } from 'vitest';
import { asyncLakes, syncLakes } from '../lakeSource';
import type { LakeJob, LakeSetup } from '../lakeJob';
import type { LakeImage } from '../lakePainter';

const setup = { basins: [] } as unknown as LakeSetup;
const job = (basin: number): LakeJob => ({ basin, depth: [], ground: [], weather: { warmth: 0, wind: { strength: 0, direction: 0 } } });
const image = (name: string) => ({ name }) as unknown as LakeImage;

describe('syncLakes', () => {
  it('paints at once, and keeps the painting while the water barely changes', () => {
    let painted = 0;
    const source = syncLakes(0.05, () => [image(`#${++painted}`)]);
    expect(source(setup, job(0), [1], '')).toEqual([image('#1')]);
    expect(source(setup, job(0), [1.01], '')).toEqual([image('#1')]);
    expect(source(setup, job(0), [1.2], '')).toEqual([image('#2')]);
  });
});

describe('asyncLakes', () => {
  /** A worker that only records what it is asked. */
  const fake = () => {
    const sent: { type: string; setupId: number; jobId?: number; job?: LakeJob }[] = [];
    let news = 0;
    const lakes = asyncLakes((m) => sent.push(m as (typeof sent)[number]), () => news++, 0.05);
    const answer = (k: number, name: string) => {
      const m = sent[k];
      lakes.receive({ setupId: m.setupId, jobId: m.jobId!, basin: m.job!.basin, images: [image(name)] });
    };
    return { lakes, sent, answer, news: () => news };
  };

  it('hands the worker the setup once, then asks it to paint, showing nothing until it answers', () => {
    const f = fake();
    expect(f.lakes.source(setup, job(0), [1], '')).toEqual([]);
    expect(f.sent.map((m) => m.type)).toEqual(['setup', 'paint']);
    f.answer(1, 'first');
    expect(f.news()).toBe(1);
    expect(f.lakes.source(setup, job(0), [1], '')).toEqual([image('first')]);
    expect(f.sent).toHaveLength(2); // nothing changed: nothing more to paint
  });

  it('keeps showing the last painting while the next is on its way, asking for one at a time per basin', () => {
    const f = fake();
    f.lakes.source(setup, job(0), [1], '');
    f.answer(1, 'first');
    f.lakes.source(setup, job(0), [1.5], '');
    expect(f.lakes.source(setup, job(0), [2], '')).toEqual([image('first')]);
    expect(f.sent.filter((m) => m.type === 'paint')).toHaveLength(2);
    f.answer(2, 'second'); // painted for 1.5; the water is at 2 by now…
    expect(f.sent.filter((m) => m.type === 'paint')).toHaveLength(3); // …so it asks again at once
  });

  it('works on each basin apart', () => {
    const f = fake();
    f.lakes.source(setup, job(0), [1], '');
    f.lakes.source(setup, job(1), [1], '');
    expect(f.sent.filter((m) => m.type === 'paint').map((m) => m.job!.basin)).toEqual([0, 1]);
  });

  it('starts over for a new map, ignoring paintings still coming for the old one', () => {
    const f = fake();
    f.lakes.source(setup, job(0), [1], '');
    const other = { basins: [] } as unknown as LakeSetup;
    f.lakes.source(other, job(0), [1], '');
    f.answer(1, 'old map');
    expect(f.lakes.source(other, job(0), [1], '')).toEqual([]);
    expect(f.sent.map((m) => m.type)).toEqual(['setup', 'paint', 'setup', 'paint']);
  });
});
