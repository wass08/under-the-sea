import type { Group, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Pane } from 'tweakpane';
export type Level = 1 | 2 | 3;
export type BenchName = 'terrain' | 'caustics' | 'shatter';
export type LevelText = { title: string; technique: string; sees: string };
export type BenchContext = { scene: Scene; root: Group; camera: PerspectiveCamera; controls: OrbitControls; renderer: WebGPURenderer; pane: Pane; settings: Record<string, boolean | number | string>; level: Level; hint: HTMLElement };
export type Bench = { update(dt: number): void; dispose(): void; setReveal(values: Record<string, boolean | number | string>): void; diagnostics(): Record<string, unknown> };
