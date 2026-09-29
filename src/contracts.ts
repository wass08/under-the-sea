/**
 * Module contracts. main.ts wires three independent modules together:
 *   World   (src/scene)   – the floating water diorama, lighting, post-processing
 *   School  (src/fish)    – GPGPU instanced fish school (compute boids)
 *   Fishing (src/fishing) – boat, fisherman, cast/bite game loop, HUD and control panel
 * Modules only talk through these interfaces (plus src/config.ts and src/state.ts).
 */
import type { DirectionalLight, Mesh, PerspectiveCamera, Raycaster, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import type { FolderApi } from 'tweakpane';

export interface Ctx {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export interface InsetRect { x: number; y: number; width: number; height: number }

export interface World {
  /** Sun light; other modules may enable castShadow on their meshes. */
  sun: DirectionalLight;
  /** The top water surface mesh (raycast target for casting). */
  surface: Mesh;
  /** Opaque terrain meshes (seabed + island), for raycasts that should block casting. */
  terrain: Mesh[];
  /**
   * Terrain height field (seabed + island) for fish obstacle avoidance.
   * heights[iz * resolution + ix] is the world-space top-of-terrain y at
   * x = -WORLD.half + (ix + .5) / resolution * 2 * WORLD.half (same mapping for z).
   * Island cells rise above WORLD.surface.
   */
  seabed: { heights: Float32Array; resolution: number };
  /** CPU mirror of the GPU surface displacement (waves + ripples) at world x/z, at the current sim time. */
  heightAt(x: number, z: number): number;
  /** CPU surface normal at world x/z. Writes into and returns target. */
  normalAt(x: number, z: number, target: Vector3): Vector3;
  /** Emit a ripple ring at a surface point. strength ≈ 0.2 (drip) … 2 (big splash). */
  ripple(point: Vector3, strength?: number): void;
  /** Advance simulation-driven world state by dt (sim seconds). */
  update(dt: number): void;
  /** Render the frame (owns the post-processing pipeline). */
  render(): void;
  /**
   * Picture-in-picture: after the main view, render() also renders `camera` into `rect`
   * (CSS pixels, origin top-left of the canvas) with the same look (underwater medium, post).
   * Pass null to disable. The caller owns the camera and any DOM frame around the rect.
   */
  setInset(camera: PerspectiveCamera | null, rect?: InsetRect): void;
  resize(): void;
  addControls(folder: FolderApi): void;
}

export interface SchoolStats {
  /** Number of fish within the curiosity radius of the lure (async readback, may lag ~100 ms). */
  nearLure: number;
  /** Bite lifecycle driven by strike()/land(). */
  biter: 'none' | 'approaching' | 'hooked';
  /** Mean school position (async readback). */
  centroid: Vector3;
  /** Mean fear 0..1 (async readback). */
  meanFear: number;
}

export interface School {
  readonly count: number;
  /** Dispatch compute for this frame. */
  update(dt: number): void;
  /** Panic wave / flash expansion radiating from a point (e.g. a lure splash). strength ≈ 1. */
  panic(origin: Vector3, strength?: number): void;
  /** Lure position in world space, or null when no line is in the water. Call every frame while it moves. */
  setLure(position: Vector3 | null): void;
  /** 0..1: how strongly fish are drawn to inspect the lure right now (the game ramps it). */
  setCuriosity(amount: number): void;
  /** Ask the nearest curious fish to dart at the lure. Returns false if no fish is close enough. */
  strike(): boolean;
  /** Resolve a hooked fish: caught → it leaves the school with the line (respawns later); otherwise it escapes in fear. */
  land(caught: boolean): void;
  readonly stats: SchoolStats;
  /** Behaviour switches driven by the on-screen dock (src/ui.ts). */
  setMilling(on: boolean): void;
  setMillingDirection(direction: 1 | -1): void;
  /** Make the predator charge through the school now (fountain effect). */
  sendPredator(): void;
  /** Flash expansion at a point, or at the school centroid when omitted. */
  flash(origin?: Vector3): void;
  /** Live behaviour state for the dock. */
  readonly behaviour: { milling: boolean; millingDirection: 1 | -1; predator: 'off' | 'cruising' | 'charging' };
  /** An extra view (the picture-in-picture camera) that GPU culling/LOD must also serve; null to remove. */
  setInsetCamera(camera: PerspectiveCamera | null): void;
  addControls(folder: FolderApi): void;
}

export interface Fishing {
  /** Auto-fish demo mode (casts and hooks by itself). */
  auto: boolean;
  update(dt: number): void;
  /** A click (not a drag) on the canvas. Return true if consumed. */
  click(raycaster: Raycaster): boolean;
  addControls(folder: FolderApi): void;
}
