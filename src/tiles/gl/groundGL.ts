import type { RGB } from '../../rendering/palette';
import { UNDER_WATER, type WaterLook, type WetLayer } from '../groundWater';
import type { Raster } from '../raster';
import { blendField } from '../hexField';
import { LOOK_RES, lookTable } from '../wetGround';
import { glAttribute, glProgram, glUniforms, type Uniforms } from './glKit';
import { RIVER_VERTEX, riverMesh } from './groundGLData';

/**
 * The flat map's ground on the GPU: the ground as painted is uploaded once
 * per map; each frame only the water's look (how wet each spot is, a small
 * grid of numbers, and the rivers as a few triangles) goes up, and the GPU
 * grades every pixel and draws the rivers, as wetGround and riverPaint do
 * on the CPU. So playing the water costs next to nothing per frame.
 */

/** How the season looks per hex (each 0–1): snow on the land, ice on the water, how lush the plants are. */
export interface SeasonFields {
  snow: ArrayLike<number>;
  ice: ArrayLike<number>;
  vigour: ArrayLike<number>;
}

/** Where the map goes on the canvas: canvas px = offset + frame px (squashed) * scale. */
export interface GroundView {
  scale: number;
  x: number;
  y: number;
  squash: number;
}

const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uFrame;
uniform vec4 uView; // scale, x, y, squash (canvas px)
uniform vec2 uCanvas;
vec4 place(vec2 frame) {
  vec2 p = uView.yz + vec2(frame.x, frame.y * uView.w) * uView.x;
  return vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT_COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uFrame;
uniform sampler2D uKeep;
uniform sampler2D uField;
uniform vec3 uGrid; // grid width, height, step (px)
uniform sampler2D uWater;
uniform vec2 uWaterSize;
out vec4 outColor;
/** smoothstep that also runs downhill (edge0 > edge1), as the CPU's does. */
float ramp(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float stageAt(vec2 frame) { return texture(uField, (frame / uGrid.z + 0.5) / uGrid.xy).r; }
bool kept(vec2 frame) { return texture(uKeep, frame / uFrame).r > 0.5; }
vec3 waterAt(vec2 frame) { return texture(uWater, frame / uWaterSize).rgb * 255.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
`;

const GROUND_VERTEX = `${COMMON}
in vec2 aPos;
out vec2 vFrame;
void main() { vFrame = aPos; gl_Position = place(aPos); }
`;

const rgb = ([r, g, b]: RGB) => `vec3(${r.toFixed(1)}, ${g.toFixed(1)}, ${b.toFixed(1)})`;

/** wetGround's gradeInto, line by line. */
const GROUND_FRAGMENT = `${FRAGMENT_COMMON}
in vec2 vFrame;
uniform sampler2D uBase;
uniform sampler2D uLook;
uniform float uLookWidth;
uniform sampler2D uDetail;
uniform float uDetailSize;
uniform sampler2D uSeason;
/** The season on the ground: plants grazed or dried to straw and earth (or lush), ice on cold water, snow on the land, bare rock where the map is painted snowy but none lies. */
vec3 seasonal(vec3 c, vec2 frame) {
  vec3 s = texture(uSeason, (frame / uGrid.z + 0.5) / uGrid.xy).rgb;
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  float green = clamp((c.g - max(c.r, c.b)) / 30.0, 0.0, 1.0);
  float blue = clamp((c.b - max(c.r, c.g) + 10.0) / 40.0, 0.0, 1.0);
  float grey = 1.0 - clamp((max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) / 30.0, 0.0, 1.0);
  float n = noise(frame * 0.06);
  vec3 straw = vec3(lum * 1.05 + 45.0, lum * 0.9 + 30.0, lum * 0.45 + 10.0);
  vec3 earth = vec3(lum * 0.85 + 38.0, lum * 0.68 + 24.0, lum * 0.5 + 10.0);
  c = mix(c, mix(straw, earth, ramp(0.35, 0.0, s.b)), green * ramp(0.7, 0.15, s.b + 0.15 * (n - 0.5)) * 0.85);
  c = mix(c, c * vec3(0.84, 1.06, 0.82), green * ramp(0.85, 1.0, s.b) * 0.5);
  float ice = ramp(0.2, 0.7, s.g + 0.25 * (n - 0.5));
  c = mix(c, vec3(206.0, 226.0, 240.0) + 20.0 * noise(frame * 0.25), ice * blue * 0.9);
  float snow = ramp(0.2, 0.75, s.r + 0.35 * (n - 0.5));
  c = mix(c, vec3(244.0, 247.0, 252.0) - 12.0 * noise(frame * 0.4), snow * 0.93 * (1.0 - blue));
  float bare = ramp(0.25, 0.0, s.r) * ramp(200.0, 232.0, lum) * grey * (1.0 - blue);
  c = mix(c, vec3(150.0, 140.0, 128.0) * (0.85 + 0.3 * noise(frame * 0.3)), bare * 0.75);
  return clamp(c, 0.0, 255.0);
}
vec3 grade(vec3 c0, float s, float puddle, float crack, vec3 water) {
  float u = (s * ${LOOK_RES.toFixed(1)} + 0.5) / uLookWidth;
  vec4 a = texture(uLook, vec2(u, 0.25)); // straw, cracks, light, saturation
  vec4 b = texture(uLook, vec2(u, 0.75)); // puddles, water shown, deep
  float lum = dot(c0, vec3(0.3, 0.59, 0.11));
  float green = clamp((c0.g - max(c0.r, c0.b)) / 50.0, 0.0, 1.0);
  vec3 c = c0 + (vec3(lum * 1.08 + 38.0, lum * 0.95 + 22.0, lum * 0.45 + 5.0) - c0) * a.x * green;
  float l = dot(c, vec3(0.3, 0.59, 0.11)) * a.z;
  c = l + (c * a.z - l) * (1.0 + a.w);
  c *= 1.0 - 0.45 * a.y * crack * clamp((c.r - c.b) / 60.0, 0.0, 1.0) * (1.0 - green);
  c += (c0 - c) * ramp(200.0, 230.0, lum);
  float share = b.x;
  if (share > 0.0) {
    float pooled = ramp(share, share - 0.04, puddle);
    c *= 1.0 - ramp(share + 0.08, share, puddle) * (1.0 - pooled) * 0.2;
    float muddy = 0.15 * (1.0 - clamp(s - 4.0, 0.0, 1.0));
    vec3 w = water + (${rgb([22, 70, 110])} - water) * b.z * 0.7 + (${rgb([74, 68, 52])} - water) * muddy;
    c += (w - c) * b.y * pooled;
  }
  return clamp(c, 0.0, 255.0);
}
void main() {
  vec4 base = texture(uBase, vFrame / uFrame);
  if (base.a < 0.5) discard;
  vec3 c = base.rgb * 255.0;
  float s = stageAt(vFrame);
  if (!kept(vFrame) && abs(s - 2.0) >= 0.01) {
    vec2 d = texture(uDetail, vFrame / uDetailSize).rg;
    c = grade(c, s, d.r, d.g, waterAt(vFrame));
  }
  c = seasonal(c, vFrame);
  outColor = vec4(c / 255.0, 1.0);
}
`;

const RIVER_VERTEX_SHADER = `${COMMON}
in vec4 aRiver; // x, y, across, foam
out vec2 vFrame;
out float vAcross;
out float vFoam;
void main() { vFrame = aRiver.xy; vAcross = aRiver.z; vFoam = aRiver.w; gl_Position = place(aRiver.xy); }
`;

/** riverPaint's bed and water, as two passes. */
const RIVER_FRAGMENT = `${FRAGMENT_COMMON}
in vec2 vFrame;
in float vAcross;
in float vFoam;
uniform int uWaterPass;
uniform float uUnder;
void main() {
  if (kept(vFrame) || stageAt(vFrame) >= uUnder) discard;
  float centre = 1.0 - abs(vAcross);
  if (uWaterPass == 0) {
    float pebbles = 0.82 + 0.36 * hash(floor(vFrame / 2.0));
    vec3 stones = mix(${rgb([162, 152, 134])}, ${rgb([112, 104, 92])}, ramp(0.5, 0.0, centre)) * pebbles;
    outColor = vec4(stones / 255.0, ramp(0.0, 0.35, centre));
  } else {
    float foam = vFoam * (0.35 + 0.65 * ramp(0.35, 0.7, noise(vFrame * vec2(0.45, 0.2))));
    vec3 w = mix(mix(waterAt(vFrame), ${rgb([24, 74, 120])}, 0.35 * centre), ${rgb([240, 248, 255])}, foam * 0.8);
    outColor = vec4(w / 255.0, ramp(0.0, 0.3, centre));
  }
}
`;

export class GroundGL {
  private readonly ground: { program: WebGLProgram; u: Uniforms; quad: WebGLBuffer };
  private readonly river: { program: WebGLProgram; u: Uniforms; bed: WebGLBuffer; water: WebGLBuffer };
  private readonly tex: Record<'base' | 'keep' | 'field' | 'look' | 'detail' | 'water' | 'season', WebGLTexture>;
  private uploaded: { base?: Raster; keep?: Uint8Array; detail?: unknown; water?: Raster; grid?: string; season?: SeasonFields } = {};
  private lookWidth: number;

  /** The GPU ground for `canvas`, or undefined where WebGL2 is not to be had. */
  static create(canvas: HTMLCanvasElement): GroundGL | undefined {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    try {
      return gl ? new GroundGL(gl) : undefined;
    } catch (e) {
      console.warn('GPU ground unavailable, painting it on the CPU', e);
      return undefined;
    }
  }

  private constructor(private readonly gl: WebGL2RenderingContext) {
    const program = (vs: string, fs: string) => glProgram(gl, vs, fs);
    const uniforms = (p: WebGLProgram, names: string[]) => glUniforms(gl, p, names);
    const shared = ['uFrame', 'uView', 'uCanvas', 'uKeep', 'uField', 'uGrid', 'uWater', 'uWaterSize'];
    const g = program(GROUND_VERTEX, GROUND_FRAGMENT);
    this.ground = { program: g, u: uniforms(g, [...shared, 'uBase', 'uLook', 'uLookWidth', 'uDetail', 'uDetailSize', 'uSeason']), quad: gl.createBuffer()! };
    const r = program(RIVER_VERTEX_SHADER, RIVER_FRAGMENT);
    this.river = { program: r, u: uniforms(r, [...shared, 'uWaterPass', 'uUnder']), bed: gl.createBuffer()!, water: gl.createBuffer()! };
    this.tex = { base: gl.createTexture()!, keep: gl.createTexture()!, field: gl.createTexture()!, look: gl.createTexture()!, detail: gl.createTexture()!, water: gl.createTexture()!, season: gl.createTexture()! };
    const look = lookTable();
    this.lookWidth = look.width;
    this.texture('look', gl.RGBA16F, look.width, 2, gl.RGBA, gl.FLOAT, look.data, gl.LINEAR, gl.CLAMP_TO_EDGE);
  }

  private texture(
    name: keyof GroundGL['tex'],
    internal: number,
    width: number,
    height: number,
    format: number,
    type: number,
    data: ArrayBufferView,
    filter: number,
    wrap: number,
  ): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  /** Upload what stays the same while the water runs, when it changed: the ground as painted, what to leave alone, detail, water art. */
  private prepare(base: Raster, layer: WetLayer, water: Raster): void {
    const gl = this.gl;
    const u = this.uploaded;
    if (u.base !== base) {
      const data = new Uint8Array(base.data.buffer, base.data.byteOffset, base.data.byteLength);
      this.texture('base', gl.RGBA8, base.width, base.height, gl.RGBA, gl.UNSIGNED_BYTE, data, gl.LINEAR, gl.CLAMP_TO_EDGE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ground.quad);
      const [w, h] = [base.width, base.height];
      gl.bufferData(gl.ARRAY_BUFFER, Float32Array.of(0, 0, w, 0, 0, h, 0, h, w, 0, w, h), gl.STATIC_DRAW);
    }
    if (u.keep !== layer.keep) {
      const keep = new Uint8Array(layer.keep.length);
      for (let i = 0; i < keep.length; i++) keep[i] = layer.keep[i] ? 255 : 0;
      this.texture('keep', gl.R8, base.width, base.height, gl.RED, gl.UNSIGNED_BYTE, keep, gl.NEAREST, gl.CLAMP_TO_EDGE);
    }
    if (u.detail !== layer.detail) {
      const { size, puddle, crack } = layer.detail;
      const rg = new Uint8Array(size * size * 2);
      for (let i = 0; i < size * size; i++) [rg[2 * i], rg[2 * i + 1]] = [puddle[i], crack[i]];
      this.texture('detail', gl.RG8, size, size, gl.RG, gl.UNSIGNED_BYTE, rg, gl.NEAREST, gl.REPEAT);
    }
    if (u.water !== water) {
      const data = new Uint8Array(water.data.buffer, water.data.byteOffset, water.data.byteLength);
      this.texture('water', gl.RGBA8, water.width, water.height, gl.RGBA, gl.UNSIGNED_BYTE, data, gl.LINEAR, gl.REPEAT);
    }
    const grid = `${layer.blend.gw}x${layer.blend.gh}`;
    if (u.grid !== grid) {
      const { gw, gh } = layer.blend;
      this.texture('field', gl.R16F, gw, gh, gl.RED, gl.FLOAT, new Float32Array(gw * gh), gl.LINEAR, gl.CLAMP_TO_EDGE);
      const neutral = new Float32Array(gw * gh * 4);
      for (let p = 0; p < gw * gh; p++) [neutral[4 * p + 2], neutral[4 * p + 3]] = [1, 1];
      this.texture('season', gl.RGBA16F, gw, gh, gl.RGBA, gl.FLOAT, neutral, gl.LINEAR, gl.CLAMP_TO_EDGE);
    }
    this.uploaded = { ...this.uploaded, base, keep: layer.keep, detail: layer.detail, water, grid: grid === u.grid ? u.grid : grid, season: grid === u.grid ? u.season : undefined };
  }

  /**
   * Draw the ground `base` (frame px) graded by the water's `look`, with its
   * rivers, onto the whole canvas (cleared first), placed by `view`.
   */
  render(base: Raster, layer: WetLayer, look: WaterLook, water: Raster, view: GroundView, season?: SeasonFields): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    this.prepare(base, layer, water);
    if (season && season !== this.uploaded.season) this.uploadSeason(layer, season);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.field);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layer.blend.gw, layer.blend.gh, gl.RED, gl.FLOAT, look.field);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const units = { uBase: 'base', uKeep: 'keep', uField: 'field', uLook: 'look', uDetail: 'detail', uWater: 'water', uSeason: 'season' } as const;
    const bind = (u: Uniforms) => {
      Object.entries(units).forEach(([name, tex], k) => {
        if (!u[name]) return;
        gl.activeTexture(gl.TEXTURE0 + k);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[tex]);
        gl.uniform1i(u[name], k);
      });
      gl.uniform2f(u.uFrame, base.width, base.height);
      gl.uniform4f(u.uView, view.scale, view.x, view.y, view.squash);
      gl.uniform2f(u.uCanvas, canvas.width, canvas.height);
      gl.uniform3f(u.uGrid, layer.blend.gw, layer.blend.gh, layer.blend.step);
      gl.uniform2f(u.uWaterSize, water.width, water.height);
    };

    // The ground, graded.
    gl.disable(gl.BLEND);
    gl.useProgram(this.ground.program);
    bind(this.ground.u);
    gl.uniform1f(this.ground.u.uLookWidth, this.lookWidth);
    gl.uniform1f(this.ground.u.uDetailSize, layer.detail.size);
    this.attribute(this.ground.program, 'aPos', this.ground.quad, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // The rivers: their beds, then the water in them, blended over the ground.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.useProgram(this.river.program);
    bind(this.river.u);
    gl.uniform1f(this.river.u.uUnder, UNDER_WATER);
    for (const [pass, part] of [
      [0, 'bed'],
      [1, 'water'],
    ] as const) {
      const mesh = riverMesh(look.lines, part);
      if (!mesh.length) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.river[part]);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      this.attribute(this.river.program, 'aRiver', this.river[part], RIVER_VERTEX);
      gl.uniform1i(this.river.u.uWaterPass, pass);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.length / RIVER_VERTEX);
    }
  }

  /** The season's look, blended over the map as the water's look is, into its texture. */
  private uploadSeason(layer: WetLayer, season: SeasonFields): void {
    const gl = this.gl;
    const { gw, gh } = layer.blend;
    const [snow, ice, vigour] = [season.snow, season.ice, season.vigour].map((v) => blendField(layer.blend, v));
    const data = new Float32Array(gw * gh * 4);
    for (let p = 0; p < gw * gh; p++) [data[4 * p], data[4 * p + 1], data[4 * p + 2], data[4 * p + 3]] = [snow[p], ice[p], vigour[p], 1];
    gl.bindTexture(gl.TEXTURE_2D, this.tex.season);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.FLOAT, data);
    this.uploaded.season = season;
  }

  /** Nothing to show: clear the canvas. */
  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private attribute(program: WebGLProgram, name: string, buffer: WebGLBuffer, size: number): void {
    glAttribute(this.gl, program, name, buffer, size);
  }
}
