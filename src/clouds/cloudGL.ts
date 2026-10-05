import { glAttribute, glProgram, glUniforms, type Uniforms } from '../tiles/gl/glKit';
import type { Raster } from '../tiles/raster';
import { SHAPES, type Puff } from './cloudDeck';
import { CLOUD_ASPECT, CLOUD_INSTANCE, cloudInstances, RAIN_INSTANCE, rainInstances, type SkyView } from './cloudGLData';

/**
 * The sky over the map, on its own canvas on top: the clouds are painted
 * solid into one layer first, so where they overlap they do not darken
 * twice, then shown through a mask that keeps their rims and thins their
 * cores (the map shows through a cloud, its shape stays clear) and opens
 * them around where the player points. Their shadows fall on the ground
 * below and to the right, away from the light; rain and snow fall in
 * shafts from under the clouds that bring it.
 */
export interface SkyLook {
  /** 'see-through': thin cores, open around `focus`; 'solid': as painted. */
  mode: 'see-through' | 'solid';
  /** Where the player points (canvas px), if anywhere. */
  focus?: { x: number; y: number };
  /** Seconds, for falling rain and snow. */
  time: number;
}

const FULLSCREEN = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const SPRITE_VERTEX = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec3 aPlace; // centre x, y, width (canvas px)
in vec3 aLook;  // shape, dark, shown
uniform vec2 uCanvas;
uniform float uAspect;
uniform float uShapes;
out vec2 vUv;
out vec2 vLook;
void main() {
  vec2 p = aPlace.xy + aCorner * vec2(aPlace.z, aPlace.z * uAspect);
  vUv = vec2((aLook.x + aCorner.x + 0.5) / uShapes, aCorner.y + 0.5);
  vLook = aLook.yz;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

const SPRITE_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUv;
in vec2 vLook;
out vec4 outColor;
void main() {
  vec4 c = texture(uAtlas, vUv); // premultiplied
  c.rgb = mix(c.rgb, c.rgb * vec3(0.62, 0.65, 0.74), vLook.x);
  outColor = c * vLook.y;
}`;

const SHADOW_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uClouds;
uniform vec2 uShift; // from a shadow to its cloud, in uv
uniform float uLod;
in vec2 vUv;
out vec4 outColor;
void main() {
  float a = textureLod(uClouds, vUv + uShift, uLod).a * 0.32;
  outColor = vec4(vec3(0.06, 0.08, 0.16) * a, a);
}`;

const COMPOSE_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uClouds;
uniform float uLod;
uniform int uSeeThrough;
uniform vec3 uFocus; // x, y (canvas px, y down), radius; radius 0: nowhere
uniform vec2 uCanvas;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uClouds, vUv);
  float keep = 0.92;
  if (uSeeThrough == 1) {
    float inside = textureLod(uClouds, vUv, uLod).a;
    keep = 0.85 - 0.5 * inside * inside;
    if (uFocus.z > 0.0) {
      vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uCanvas;
      keep *= mix(0.12, 1.0, smoothstep(uFocus.z * 0.32, uFocus.z, distance(px, uFocus.xy)));
    }
  }
  outColor = c * keep;
}`;

const RAIN_VERTEX = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aBox;   // left, top, width, height
in vec3 aFall;  // how hard, snow, seed
uniform vec2 uCanvas;
out vec2 vUv;
out vec2 vSize;
out vec3 vFall;
void main() {
  vec2 uv = aCorner + 0.5;
  vec2 p = aBox.xy + uv * aBox.zw;
  vUv = uv;
  vSize = aBox.zw;
  vFall = aFall;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

const RAIN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform float uTime;
uniform float uPx; // canvas px per CSS px
in vec2 vUv;
in vec2 vSize;
in vec3 vFall;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float edge = sin(vUv.x * 3.14159) * smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
  vec2 px = vUv * vSize / uPx;
  float a;
  vec3 colour;
  if (vFall.y > 0.5) {
    // Snow: flakes drifting down, swaying.
    vec2 p = px / 7.0;
    p.y -= uTime * 1.6;
    p.x += sin(uTime * 1.3 + p.y * 0.8 + vFall.z) * 0.35;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5 - (vec2(hash(cell + vFall.z), hash(cell.yx + 3.1)) - 0.5) * 0.5;
    float on = step(1.0 - vFall.x * 0.8, hash(cell * 1.7 + vFall.z));
    a = smoothstep(0.2, 0.06, length(f)) * on * 0.9;
    colour = vec3(1.0);
  } else {
    // Rain: thin streaks falling fast, in columns of their own pace.
    float column = floor(px.x / 3.0);
    float h = hash(vec2(column, vFall.z));
    float y = px.y / 18.0 - uTime * (6.5 + 2.0 * h) + h * 13.0; // about 120–155 px a second
    float f = fract(y);
    float on = step(1.0 - vFall.x * 0.7, hash(vec2(column, floor(y) + vFall.z)));
    float line = 1.0 - smoothstep(0.5, 1.0, abs(fract(px.x / 3.0) - 0.5) * 3.0);
    a = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.1, 0.45, f)) * on * line * 0.7 + vFall.x * 0.1;
    colour = vec3(0.86, 0.9, 0.97);
  }
  a *= edge;
  outColor = vec4(colour * a, a);
}`;

/** Corners of a unit quad, as two triangles. */
const QUAD = Float32Array.of(-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5);
/** Shadows fall this far from their clouds, in shares of the clouds' altitude: right and down, away from the light. */
const SHADOW_SHIFT = { x: 0.45, y: 0.3 };
/** A cloud's core is what lies about this share of a hex (on screen) inside its rim: there it thins. */
const CORE_BLUR = 1.2;
/** The clouds' own layer is this much finer than the canvas: they are soft, and it is four times fewer pixels to paint. */
const LAYER_SCALE = 0.5;
/** Clouds open up to this far (CSS px) around where the player points. */
const FOCUS_RADIUS = 190;

interface Pass {
  program: WebGLProgram;
  u: Uniforms;
  /** Its own vertex state, so one pass's attributes never get in another's way. */
  vao: WebGLVertexArrayObject;
}

export class CloudGL {
  private readonly sprite: Pass;
  private readonly shadow: Pass;
  private readonly compose: Pass;
  private readonly rain: Pass;
  private readonly buffers: { quad: WebGLBuffer; clouds: WebGLBuffer; rain: WebGLBuffer };
  private readonly atlas: WebGLTexture;
  private readonly layer: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

  /** The sky for `canvas`, or undefined where WebGL2 is not to be had. */
  static create(canvas: HTMLCanvasElement, atlas: Raster): CloudGL | undefined {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    try {
      return gl ? new CloudGL(gl, atlas) : undefined;
    } catch (e) {
      console.warn('Clouds unavailable', e);
      return undefined;
    }
  }

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    atlas: Raster,
  ) {
    const pass = (vs: string, fs: string, names: string[]): Pass => {
      const program = glProgram(gl, vs, fs);
      return { program, u: glUniforms(gl, program, names), vao: gl.createVertexArray()! };
    };
    this.sprite = pass(SPRITE_VERTEX, SPRITE_FRAGMENT, ['uCanvas', 'uAspect', 'uShapes', 'uAtlas']);
    this.shadow = pass(FULLSCREEN, SHADOW_FRAGMENT, ['uClouds', 'uShift', 'uLod']);
    this.compose = pass(FULLSCREEN, COMPOSE_FRAGMENT, ['uClouds', 'uLod', 'uSeeThrough', 'uFocus', 'uCanvas']);
    this.rain = pass(RAIN_VERTEX, RAIN_FRAGMENT, ['uCanvas', 'uTime', 'uPx']);
    this.buffers = { quad: gl.createBuffer()!, clouds: gl.createBuffer()!, rain: gl.createBuffer()! };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    for (const [p, instances, attributes] of [
      [this.sprite, this.buffers.clouds, [['aPlace', 3, CLOUD_INSTANCE, 0], ['aLook', 3, CLOUD_INSTANCE, 3]]],
      [this.rain, this.buffers.rain, [['aBox', 4, RAIN_INSTANCE, 0], ['aFall', 3, RAIN_INSTANCE, 4]]],
    ] as const) {
      gl.bindVertexArray(p.vao);
      glAttribute(gl, p.program, 'aCorner', this.buffers.quad, 2);
      for (const [name, size, stride, offset] of attributes) glAttribute(gl, p.program, name, instances, size, stride, offset, 1);
    }
    gl.bindVertexArray(null);

    this.atlas = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(atlas.data.buffer, atlas.data.byteOffset, atlas.data.byteLength));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.layer = { fbo: gl.createFramebuffer()!, tex: gl.createTexture()!, w: 0, h: 0 };
  }

  /** The layer the clouds are painted into first, `w` x `h` px. */
  private sizeLayer(w: number, h: number): void {
    const gl = this.gl;
    const l = this.layer;
    if (l.w === w && l.h === h) return;
    gl.bindTexture(gl.TEXTURE_2D, l.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, l.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, l.tex, 0);
    Object.assign(l, { w, h });
  }

  /** Draw `puffs` placed by `view` (canvas px), as `look` has them; `hex` is a hex's width on the canvas. */
  render(puffs: readonly Puff[], view: SkyView, look: SkyLook, hex: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const [w, h] = [canvas.width, canvas.height];
    this.sizeLayer(Math.ceil(w * LAYER_SCALE), Math.ceil(h * LAYER_SCALE));
    const clouds = cloudInstances(puffs, view);
    const lod = Math.log2(Math.max(1, hex * CORE_BLUR * LAYER_SCALE));

    // The clouds, solid, into their layer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.layer.fbo);
    gl.viewport(0, 0, this.layer.w, this.layer.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (clouds.length) {
      const s = this.sprite;
      gl.useProgram(s.program);
      gl.uniform2f(s.u.uCanvas, w, h);
      gl.uniform1f(s.u.uAspect, CLOUD_ASPECT);
      gl.uniform1f(s.u.uShapes, SHAPES);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.uniform1i(s.u.uAtlas, 0);
      gl.bindVertexArray(s.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.clouds);
      gl.bufferData(gl.ARRAY_BUFFER, clouds, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, clouds.length / CLOUD_INSTANCE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.layer.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Onto the canvas: shadows, the clouds, and rain and snow falling from under them (over the clouds in front, so it shows).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!clouds.length) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.layer.tex);

    const sh = this.shadow;
    gl.useProgram(sh.program);
    gl.bindVertexArray(sh.vao);
    gl.uniform1i(sh.u.uClouds, 0);
    const alt = view.altitude * view.scale;
    gl.uniform2f(sh.u.uShift, (-SHADOW_SHIFT.x * alt) / w, (alt * (1 + SHADOW_SHIFT.y)) / h);
    gl.uniform1f(sh.u.uLod, Math.max(0, lod - 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const c = this.compose;
    gl.useProgram(c.program);
    gl.bindVertexArray(c.vao);
    gl.uniform1i(c.u.uClouds, 0);
    gl.uniform1f(c.u.uLod, lod);
    gl.uniform1i(c.u.uSeeThrough, look.mode === 'see-through' ? 1 : 0);
    const f = look.focus;
    gl.uniform3f(c.u.uFocus, f?.x ?? 0, f?.y ?? 0, f ? FOCUS_RADIUS * (w / (canvas.clientWidth || w)) : 0);
    gl.uniform2f(c.u.uCanvas, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const rain = rainInstances(puffs, view);
    if (rain.length) {
      const r = this.rain;
      gl.useProgram(r.program);
      gl.uniform2f(r.u.uCanvas, w, h);
      gl.uniform1f(r.u.uTime, look.time);
      gl.uniform1f(r.u.uPx, Math.max(1, w / canvas.clientWidth || 1));
      gl.bindVertexArray(r.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.rain);
      gl.bufferData(gl.ARRAY_BUFFER, rain, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, rain.length / RAIN_INSTANCE);
    }
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
