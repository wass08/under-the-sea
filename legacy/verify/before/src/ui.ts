import { state } from './state';
import './style.css';
export function createUI(actions: { shatter(): void; reset(): void; toggleTime(): void }) {
  const panel = document.createElement('section'); panel.className = 'controls'; panel.setAttribute('aria-label', 'Aquarium controls');
  panel.innerHTML = `<div class="control-top"><span id="mode-label"><i></i> In equilibrium</span><span id="fps">— FPS</span></div><p>Click a wall to slosh the water</p><div class="buttons"><button id="shatter"><span class="button-icon">✳</span> Shatter <kbd>SPACE</kbd></button><button id="slow" aria-pressed="false">Slow motion <kbd>T</kbd></button><button id="reset" aria-label="Reset aquarium">Reset <kbd>R</kbd></button></div><span class="sr-only">Click a wall to slosh the water - Space: shatter - T: slow motion - R: reset</span>`;
  document.body.appendChild(panel);
  const shatter = panel.querySelector<HTMLButtonElement>('#shatter')!;
  const slow = panel.querySelector<HTMLButtonElement>('#slow')!;
  const reset = panel.querySelector<HTMLButtonElement>('#reset')!;
  const label = panel.querySelector<HTMLElement>('#mode-label')!;
  const fps = panel.querySelector<HTMLElement>('#fps')!;
  shatter.onclick = () => actions.shatter(); slow.onclick = () => actions.toggleTime(); reset.onclick = () => actions.reset();
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); actions.shatter(); }
    if (e.code === 'KeyT') actions.toggleTime();
    if (e.code === 'KeyR') actions.reset();
  });
  let frames = 0, total = 0;
  return { update(dt: number) {
    frames++; total += dt;
    if (total >= 0.7) { fps.textContent = `${Math.round(frames / total)} FPS`; frames = 0; total = 0; }
    const broken = state.mode === 'shattered';
    label.innerHTML = `<i class="${broken ? 'broken' : ''}"></i> ${broken ? `${state.brokenCount} fragments · draining` : 'In equilibrium'}`;
    slow.setAttribute('aria-pressed', String(state.timeScale < 1));
    slow.classList.toggle('active', state.timeScale < 1); shatter.disabled = broken;
  } };
}
