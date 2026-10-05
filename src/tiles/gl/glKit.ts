/** Small helpers shared by the WebGL2 layers. */

export type Uniforms = Record<string, WebGLUniformLocation | null>;

/** A linked program from vertex and fragment shader source; throws with the compiler's log if either fails. */
export function glProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
  return p;
}

export const glUniforms = (gl: WebGL2RenderingContext, p: WebGLProgram, names: readonly string[]): Uniforms =>
  Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));

/** Point attribute `name` of `program` at `buffer`: `size` floats per vertex (or per instance, with `divisor` 1), `stride` and `offset` in floats. */
export function glAttribute(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, buffer: WebGLBuffer, size: number, stride = 0, offset = 0, divisor = 0): void {
  const at = gl.getAttribLocation(program, name);
  if (at < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride * 4, offset * 4);
  gl.vertexAttribDivisor(at, divisor);
}
