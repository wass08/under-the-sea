import { state } from './state';
import './style.css';
export function createUI(actions: { shatter(): void; reset(): void; toggleTime(): void; toggleSound(): void; toggleLamp(): void }) {
  const series = document.querySelector<HTMLElement>('.series')!, spoiler = series.querySelector<HTMLElement>('.topic-spoiler')!;
  let hovered = false, focused = false, pinned = false;
  const reveal = () => {
    const visible = hovered || focused || pinned;
    spoiler.classList.toggle('revealed', pinned); spoiler.setAttribute('aria-expanded', String(visible));
    spoiler.setAttribute('aria-label', visible ? 'Topic: Voronoi & Delaunay' : 'Reveal the topic');
    spoiler.firstElementChild!.setAttribute('aria-hidden', String(!visible));
  };
  series.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') { hovered = true; reveal(); } });
  series.addEventListener('pointerleave', () => { hovered = false; reveal(); });
  spoiler.addEventListener('focus', () => { focused = true; reveal(); });
  spoiler.addEventListener('blur', () => { focused = false; reveal(); });
  spoiler.addEventListener('click', e => { e.stopPropagation(); pinned = !pinned; spoiler.blur(); reveal(); });
  spoiler.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); pinned = !pinned; reveal(); } });
  const panel = document.createElement('section'); panel.className = 'controls'; panel.setAttribute('aria-label', 'Aquarium controls');
  panel.innerHTML = `<div class="control-top"><span id="mode-label"><i></i> In equilibrium</span><span id="fps">— FPS</span></div><p>Click a wall to crack the glass · Space to shatter · L to toggle lamp</p><div class="buttons"><button id="shatter"><span class="button-icon">✳</span> Shatter <kbd>SPACE</kbd></button><button id="slow" aria-pressed="false">Slow motion <kbd>T</kbd></button><button id="reset" aria-label="Reset aquarium">Reset <kbd>R</kbd></button><button id="sound" aria-pressed="true">Sound on <kbd>M</kbd></button></div><span class="sr-only">Click a wall to crack the glass · Space to shatter · L to toggle lamp - Space: shatter - T: slow motion - R: reset - L: toggle lamp</span>`;
  document.body.appendChild(panel);
  const shatter = panel.querySelector<HTMLButtonElement>('#shatter')!;
  const slow = panel.querySelector<HTMLButtonElement>('#slow')!;
  const reset = panel.querySelector<HTMLButtonElement>('#reset')!;
  const label = panel.querySelector<HTMLElement>('#mode-label')!;
  const sound = panel.querySelector<HTMLButtonElement>('#sound')!;
  sound.onclick = () => actions.toggleSound();
  const fps = panel.querySelector<HTMLElement>('#fps')!;
  shatter.onclick = () => actions.shatter(); slow.onclick = () => actions.toggleTime(); reset.onclick = () => actions.reset();
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); actions.shatter(); }
    if (e.code === 'KeyT') actions.toggleTime();
    if (e.code === 'KeyL') actions.toggleLamp();
    if (e.code === 'KeyM') actions.toggleSound();
    if (e.code === 'KeyR') actions.reset();
  });
  let frames = 0, total = 0;
  let displayedStatus = label.innerHTML;
  return { update(dt: number) {
    frames++; total += dt;
    if (total >= 0.25) { state.fps = Math.round(frames / total); fps.textContent = `${state.fps} FPS`; frames = 0; total = 0; }
    const broken = state.mode === 'shattered';
    const status = `<i class="${broken ? 'broken' : ''}"></i> ${state.rewinding ? 'Rewinding' : broken ? 'Shattered' : state.cracks ? 'Cracked' : 'Idle'}${state.spilling ? ' · spilling' : ''}`;
    if (status !== displayedStatus) { label.innerHTML = status; displayedStatus = status; }
    sound.setAttribute('aria-pressed', String(!state.muted));
    const soundText = `Sound ${state.muted ? 'off' : 'on'} <kbd>M</kbd>`;
    if (sound.innerHTML !== soundText) sound.innerHTML = soundText;
    slow.setAttribute('aria-pressed', String(state.timeScale < 1));
    slow.classList.toggle('active', state.timeScale < 1); shatter.disabled = broken;
  } };
}
