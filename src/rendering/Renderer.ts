import type { World } from '../world/World';
import type { Camera } from './Camera';

/**
 * Backend-agnostic renderer surface. Anything the game engine knows about the
 * renderer goes through this interface — concrete backends (canvas, webgl, …)
 * implement it without leaking their details.
 */
export interface Renderer {
  attach(host: HTMLElement): void;
  detach(): void;
  resize(width: number, height: number): void;
  render(world: World, camera: Camera): void;
}
