import { hexTopology, isInner, opposite, pipeSteps, pipeTarget, type HexTopology } from './hexTopology';

/**
 * Rivers as the land remembers them. Every hex drains to one neighbour: the
 * lowest, with hollows filled up to where they spill over, so every route
 * runs on to the sea or the map's edge. Along these routes the water each
 * hex gives (what runs off it, more than runs onto it) gathers into rivers,
 * which grow as they run down, and a hex passes on only the share of its
 * incoming water that actually leaves it, so a lake that is still filling
 * holds what reaches it and sends no river on. Per hex is kept how much
 * runs through now (smoothed, so a river does not flicker) and the bed that
 * water has worn: it deepens quickly while much runs and fades only very
 * slowly once the river runs dry, so a dry river bed stays a long time.
 */
export interface Channels {
  /** Water running through each hex now (steps per step), smoothed. */
  flow: Float32Array;
  /** The flow each hex's bed was worn for. */
  bed: Float32Array;
  /** The hex each hex drains to, or -1 where water leaves the map. */
  down: Int32Array;
  /** Every hex after the hex it drains to. */
  order: Int32Array;
  /** Steps since the routes were last worked out. */
  age: number;
}

export interface ChannelParams {
  /** Share of the change in flow followed per step. */
  follow: number;
  /** Share of the extra flow a bed deepens for per step… */
  wear: number;
  /** …and the share of it lost per step while less runs. */
  fade: number;
  /** Steps between working out the routes again: the ground wears only slowly. */
  reroute: number;
}

export const DEFAULT_CHANNELS: ChannelParams = { follow: 0.2, wear: 0.012, fade: 0.0012, reroute: 50 };

/** Rise across a flat or a filled hollow per hex, so its routes run the shortest way to where it spills. */
const FLAT_RISE = 1e-5;

export const createChannels = ({ n }: HexTopology): Channels => ({
  flow: new Float32Array(n),
  bed: new Float32Array(n),
  down: new Int32Array(n).fill(-1),
  order: new Int32Array(0),
  age: 0,
});

/**
 * Routes by priority flood from where water leaves the map (`sink`, or the
 * lowest hex if there is none): hexes are reached lowest first, each from
 * its lowest neighbour, and `order` lists them as reached. Edges only.
 * Given the `bed`s rivers have worn, a hex drains instead into a neighbour
 * carrying a far bigger river, if that lies no higher: water follows the
 * channels already there, so streams join into rivers rather than running
 * side by side down a slope.
 */
export function floodRoute(edges: HexTopology, ground: ArrayLike<number>, sink: ArrayLike<number>, bed?: ArrayLike<number>): { down: Int32Array; order: Int32Array } {
  const { n } = edges;
  const down = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const level = new Float32Array(n);
  const seen = new Uint8Array(n);
  const heap = new MinHeap(level, n);
  const seed = (i: number) => {
    seen[i] = 1;
    level[i] = ground[i];
    heap.push(i);
  };
  for (let i = 0; i < n; i++) if (sink[i]) seed(i);
  if (!heap.size && n) seed(lowest(ground));
  let count = 0;
  while (heap.size) {
    const i = heap.pop();
    order[count++] = i;
    for (let d = 0; d < 6; d++) {
      const j = pipeTarget(edges, i, d);
      if (j < 0 || seen[j]) continue;
      seen[j] = 1;
      level[j] = Math.max(ground[j], level[i] + FLAT_RISE);
      down[j] = i;
      heap.push(j);
    }
  }
  if (bed) joinStreams(edges, level, order.subarray(0, count), bed, down);
  return { down, order: order.subarray(0, count) };
}

/** A river this many times bigger than the steepest way down draws a hex's water. */
const JOIN = 2;

/** Re-route each hex into the neighbour with the biggest bed, among those reached before it (so no circles) and no higher. */
function joinStreams(edges: HexTopology, level: Float32Array, order: Int32Array, bed: ArrayLike<number>, down: Int32Array): void {
  const rank = new Int32Array(edges.n).fill(-1);
  order.forEach((i, k) => (rank[i] = k));
  for (const i of order) {
    if (down[i] < 0) continue;
    let best = down[i];
    for (let d = 0; d < 6; d++) {
      const j = pipeTarget(edges, i, d);
      if (j < 0 || rank[j] < 0 || rank[j] > rank[i] || level[j] > level[i]) continue;
      if (bed[j] > JOIN * bed[best] && bed[j] > bed[i]) best = j;
    }
    down[i] = best;
  }
}

/** Index of the lowest value. */
function lowest(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[best]) best = i;
  return best;
}

/** Reused per step: a step allocates nothing. */
const scratch = { source: new Float32Array(0), leaving: new Float32Array(0), gathered: new Float32Array(0) };
const sized = (key: keyof typeof scratch, n: number) => (scratch[key].length >= n ? scratch[key] : (scratch[key] = new Float32Array(n))).subarray(0, n);

/**
 * Per hex, from the flow through its pipes (water passing both ways counts
 * once): the water it gives (more running out than in) and the share of its
 * incoming water it lets go (1 if it gives). Reused buffers.
 */
export function waterBalance(topo: HexTopology, flux: Float32Array, sink: Uint8Array): { source: Float32Array; leaving: Float32Array } {
  const { cols, rows, n, dirs } = topo;
  const [source, leaving] = [sized('source', n), sized('leaving', n)];
  const steps = pipeSteps(topo);
  const back = Int8Array.from({ length: dirs }, (_, d) => opposite(d));
  for (let row = 0, i = 0; row < rows; row++) {
    const parity = (row & 1) * dirs;
    for (let col = 0; col < cols; col++, i++) {
      source[i] = 0;
      leaving[i] = 1;
      if (sink[i]) continue;
      const fast = isInner(topo, row, col);
      let into = 0;
      let out = 0;
      for (let d = 0; d < dirs; d++) {
        const j = fast ? i + steps[parity + d] : pipeTarget(topo, i, d);
        const net = flux[i * dirs + d] - (j < 0 ? 0 : flux[j * dirs + back[d]]);
        if (net > 0) out += net;
        else into -= net;
      }
      if (out > into) source[i] = out - into;
      else if (into > 0) leaving[i] = out / into;
    }
  }
  return { source, leaving };
}

/** Into `out`: per hex, the water running through it, gathered upstream first along the routes. */
export function accumulate(down: Int32Array, order: Int32Array, source: ArrayLike<number>, leaving: ArrayLike<number>, out: Float32Array): Float32Array {
  out.fill(0);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    out[i] = (out[i] + source[i]) * leaving[i];
    if (down[i] >= 0) out[down[i]] += out[i];
  }
  return out;
}

/** One step, in place, after a step of flow: `ground` and `flux` are read. */
export function channelStep(topo: HexTopology, ground: ArrayLike<number>, flux: Float32Array, sink: Uint8Array, ch: Channels, params: ChannelParams = DEFAULT_CHANNELS): void {
  const { follow, wear, fade, reroute } = params;
  if (ch.age++ % reroute === 0) Object.assign(ch, floodRoute(hexTopology(topo.cols, topo.rows, 6), ground, sink, ch.bed));
  const { source, leaving } = waterBalance(topo, flux, sink);
  const through = accumulate(ch.down, ch.order, source, leaving, sized('gathered', topo.n));
  for (let i = 0; i < topo.n; i++) {
    const flow = (ch.flow[i] += follow * ((sink[i] ? 0 : through[i]) - ch.flow[i]));
    ch.bed[i] += flow > ch.bed[i] ? wear * (flow - ch.bed[i]) : -fade * ch.bed[i];
  }
}

/** A binary min-heap of hex indices, keyed by `key[i]`. */
class MinHeap {
  private items: Int32Array;
  size = 0;
  constructor(
    private key: Float32Array,
    capacity: number,
  ) {
    this.items = new Int32Array(capacity);
  }
  push(i: number): void {
    const a = this.items;
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.key[a[p]] <= this.key[i]) break;
      a[k] = a[p];
      k = p;
    }
    a[k] = i;
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a[--this.size];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= this.size) break;
      const c = l + 1 < this.size && this.key[a[l + 1]] < this.key[a[l]] ? l + 1 : l;
      if (this.key[a[c]] >= this.key[last]) break;
      a[k] = a[c];
      k = c;
    }
    a[k] = last;
    return top;
  }
}
