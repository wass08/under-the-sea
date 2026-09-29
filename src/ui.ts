import { Pane } from 'tweakpane';
import type { FolderApi } from 'tweakpane';
import { state } from './state';

/** Global control panel. Modules add their own folders. */
export function createPanel() {
  const pane = new Pane({ title: 'Controls', expanded: true });
  pane.element.parentElement!.classList.add('panel');
  const perf = { fps: 0 };
  pane.addBinding(perf, 'fps', { readonly: true, label: 'FPS', format: (v: number) => v.toFixed(0) });
  pane.addBinding(state, 'timeScale', { min: 0.05, max: 1.5, step: 0.05, label: 'time' });
  let frames = 0, total = 0;
  return {
    folder(title: string, expanded = false): FolderApi { return pane.addFolder({ title, expanded }); },
    update(dt: number) {
      frames++; total += dt;
      if (total >= 0.25) { state.fps = perf.fps = frames / total; frames = 0; total = 0; }
    },
  };
}
