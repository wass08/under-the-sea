import { Pane } from 'tweakpane';
import type { FolderApi } from 'tweakpane';
import { state } from './state';
import type { Fishing, School } from './contracts';

/** Tuning panel (collapsed by default: the dock below is the primary control surface). */
export function createPanel() {
  const pane = new Pane({ title: 'Tuning', expanded: false });
  pane.element.parentElement!.classList.add('panel');
  const perf = { fps: 0 };
  pane.addBinding(perf, 'fps', { readonly: true, label: 'FPS', format: (v: number) => v.toFixed(0) });
  pane.addBinding(state, 'timeScale', { min: 0.05, max: 1.5, step: 0.05, label: 'time' });
  let frames = 0, total = 0;
  return {
    folder(title: string, expanded = false): FolderApi { return pane.addFolder({ title, expanded }); },
    update(dt: number) {
      frames++; total += dt;
      if (total >= 0.25) { state.fps = perf.fps = frames / total; frames = 0; total = 0; pane.refresh(); }
    },
  };
}

const SLOW = 0.25;
const icons = {
  milling: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="16" cy="16" r="10" opacity=".45"/><circle cx="16" cy="16" r="2.2" fill="currentColor" stroke="none" opacity=".6"/><g class="orbit"><path d="M12.6 6.6 17.8 6l-2.9 4.2z" fill="currentColor" stroke="none"/><path d="M19.4 25.4 14.2 26l2.9-4.2z" fill="currentColor" stroke="none"/></g></svg>',
  flip: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 6.5a5 5 0 0 1 9-1.5M13 9.5a5 5 0 0 1-9 1.5"/><path d="M12.5 2.5V5.5H9.5M3.5 13.5V10.5H6.5"/></svg>',
  fountain: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 16h9l4-3.5v7L13 16"/><path d="M17 12.5 24 8M17 19.5l7 4.5M20 16h8" opacity=".55"/><circle cx="7" cy="9" r="1" fill="currentColor"/><circle cx="7" cy="23" r="1" fill="currentColor"/><circle cx="11" cy="7" r="1" fill="currentColor"/><circle cx="11" cy="25" r="1" fill="currentColor"/></svg>',
  flash: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="16" cy="16" r="3"/><path d="M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M7.5 24.5l2.8-2.8M21.7 10.3l2.8-2.8"/></svg>',
  slow: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="16" cy="17" r="10"/><path d="M16 11v6l4 2.5M13 4h6"/></svg>',
  auto: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 26 22 5"/><path d="M22 5c3 6 4 12 3 18"/><path d="M25 23c0 2-1.5 3-3 3s-2.4-1.3-2.4-2.6"/></svg>',
};

/** On-screen behaviour dock: the primary way to drive the school on camera. */
export function createDock(school: School, fishing: Fishing) {
  const dock = document.createElement('nav');
  dock.className = 'dock'; dock.setAttribute('aria-label', 'School behaviours');
  const button = (id: string, label: string, key: string, icon: string, hint: string) =>
    `<button class="dock-item" id="dock-${id}" aria-pressed="false" title="${hint} (${key})"><span class="dock-icon">${icon}</span><span class="dock-label">${label}</span><kbd>${key}</kbd></button>`;
  dock.innerHTML = [
    `<div class="dock-group">${button('milling', 'Milling', 'M', icons.milling, 'Toggle milling around the island')}<button class="dock-flip" id="dock-flip" title="Flip milling direction (D)" aria-label="Flip milling direction">${icons.flip}</button></div>`,
    button('fountain', 'Fountain', 'F', icons.fountain, 'Send the predator through the school'),
    button('flash', 'Flash', 'X', icons.flash, 'Flash expansion at the school centre'),
    '<span class="dock-sep" aria-hidden="true"></span>',
    button('slow', 'Slow-mo', 'T', icons.slow, 'Slow motion'),
    button('auto', 'Auto-fish', 'A', icons.auto, 'Let the fisherman fish by himself'),
  ].join('');
  document.body.appendChild(dock);
  const $ = (id: string) => dock.querySelector<HTMLButtonElement>(`#dock-${id}`)!;
  const pulse = (el: HTMLElement) => { el.classList.remove('fired'); void el.offsetWidth; el.classList.add('fired'); };

  const actions: Record<string, () => void> = {
    milling: () => school.setMilling(!school.behaviour.milling),
    flip: () => { school.setMillingDirection(school.behaviour.millingDirection === 1 ? -1 : 1); pulse($('flip')); },
    fountain: () => { school.sendPredator(); pulse($('fountain')); },
    flash: () => { school.flash(); pulse($('flash')); },
    slow: () => { state.timeScale = state.timeScale < 1 ? 1 : SLOW; },
    auto: () => { fishing.auto = !fishing.auto; },
  };
  for (const id of Object.keys(actions)) $(id).addEventListener('click', e => { e.stopPropagation(); actions[id](); });
  const keys: Record<string, string> = { KeyM: 'milling', KeyD: 'flip', KeyF: 'fountain', KeyX: 'flash', KeyT: 'slow', KeyA: 'auto' };
  addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest?.('input, textarea, .tp-dfwv')) return;
    const id = keys[e.code]; if (id) { e.preventDefault(); actions[id](); }
  });

  const set = (id: string, on: boolean) => { const el = $(id); if (el.classList.contains('active') !== on) { el.classList.toggle('active', on); el.setAttribute('aria-pressed', String(on)); } };
  return {
    update() {
      const b = school.behaviour;
      if (!b) return; // module not providing the dock API yet
      set('milling', b.milling);
      dock.classList.toggle('ccw', b.millingDirection === -1);
      set('fountain', b.predator !== 'off');
      $('fountain').classList.toggle('charging', b.predator === 'charging');
      set('slow', state.timeScale < 1);
      set('auto', Boolean(fishing.auto));
    },
  };
}
