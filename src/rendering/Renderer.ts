import type { World } from '../world/World';
import type { Camera } from './Camera';
import type { WindField } from '../airflow/WindField';

/**
 * Per-frame state handed to the renderer. Only `world` and `camera` are
 * required; any number of optional overlays can ride along (wind field,
 * future temperature, settlements, etc.) without changing the interface.
 */
export interface RenderFrame {
  world: World;
  camera: Camera;
  windField?: WindField;
}

/**
 * Backend-agnostic renderer surface. Concrete backends (canvas, webgl, …)
 * implement it without leaking their details to the rest of the app.
 */
export interface Renderer {
  attach(host: HTMLElement): void;
  detach(): void;
  resize(width: number, height: number): void;
  render(frame: RenderFrame): void;
}
