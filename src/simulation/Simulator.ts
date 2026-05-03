import type { World } from '../world/World';

/**
 * A simulation step that mutates the world in place. New mechanics (erosion,
 * weather, fauna, …) get added as additional SimulationLayer objects.
 */
export interface SimulationLayer {
  readonly name: string;
  step(world: World, dt: number): void;
}

export class Simulator {
  private layers: SimulationLayer[] = [];

  add(layer: SimulationLayer): this {
    this.layers.push(layer);
    return this;
  }

  step(world: World, dt: number): void {
    for (const layer of this.layers) layer.step(world, dt);
  }
}
