import type { World } from '../world/World';
import type { Camera } from './Camera';
import type { WindField } from '../airflow/WindField';
import type { WindSource, WindSink } from '../airflow/sources';

/**
 * Per-frame state handed to the renderer. Only `world` and `camera` are
 * required; any number of optional overlays can ride along (wind field,
 * future temperature, settlements, etc.) without changing the interface.
 */
export interface RenderFrame {
  world: World;
  camera: Camera;
  windField?: WindField;
  windSources?: ReadonlyArray<WindSource>;
  windSinks?: ReadonlyArray<WindSink>;
  /**
   * Reference density used by the density overlay to set alpha. Typically
   * matches the burst strength so a fresh parcel reads as fully opaque.
   * If undefined, the density overlay is not drawn.
   */
  densityReference?: number;
  /**
   * In-progress source preview, in *world* pixel coords (not screen coords).
   * The renderer applies its own world transform; the caller has already
   * converted screen → world space.
   */
  sourcePreview?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
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
