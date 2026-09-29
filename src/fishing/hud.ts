import type { Game } from './game';

const FISH_ICON = `<svg viewBox="0 0 32 20" aria-hidden="true"><path d="M2 10c4-6 10-8 16-6 3 1 5 3 6 6-1 3-3 5-6 6-6 2-12 0-16-6z" fill="currentColor" opacity=".92"/><path d="M22 10l8-6v12z" fill="currentColor"/><circle cx="8" cy="8.5" r="1.3" fill="#0a1a2b"/><path d="M14 5c1.5 3 1.5 7 0 10" stroke="#0a1a2b" stroke-opacity=".35" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`;

/** DOM overlay: catch counter pill + status line + the big "Click to hook!" prompt with a countdown ring. */
export function createHud() {
  const root = document.createElement('div');
  root.className = 'fishing-hud';
  root.innerHTML = `
    <div class="fh-pill">
      <div class="fh-count"><span class="fh-icon">${FISH_ICON}</span><span class="fh-label">Caught</span><b class="fh-n">0</b></div>
      <div class="fh-status"><span class="fh-status-text">Click the water to cast</span></div>
    </div>
    <div class="fh-prompt" aria-live="assertive">
      <svg class="fh-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="fh-ring-bg" cx="50" cy="50" r="44"/><circle class="fh-ring-fg" cx="50" cy="50" r="44" pathLength="100"/></svg>
      <span class="fh-prompt-text">Click to hook!</span>
    </div>`;
  document.body.appendChild(root);
  const n = root.querySelector<HTMLElement>('.fh-n')!, statusEl = root.querySelector<HTMLElement>('.fh-status-text')!;
  const pill = root.querySelector<HTMLElement>('.fh-pill')!, count = root.querySelector<HTMLElement>('.fh-count')!;
  const prompt = root.querySelector<HTMLElement>('.fh-prompt')!, ring = root.querySelector<SVGCircleElement>('.fh-ring-fg')!;

  let shownCount = 0, shownStatus = 'Click the water to cast', promptOn = false;
  function pop() {
    n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.7)', color: '#9fe6ff' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
    count.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    pill.animate([{ boxShadow: '0 0 0 0 #9fe6ff88' }, { boxShadow: '0 0 0 14px #9fe6ff00' }], { duration: 700, easing: 'ease-out' });
    const plus = document.createElement('span'); plus.className = 'fh-plus'; plus.textContent = '+1'; count.appendChild(plus);
    plus.animate([{ opacity: 0, transform: 'translateY(4px) scale(.7)' }, { opacity: 1, transform: 'translateY(-10px) scale(1)', offset: 0.25 }, { opacity: 0, transform: 'translateY(-26px) scale(1)' }], { duration: 900, easing: 'ease-out' }).onfinish = () => plus.remove();
  }
  return {
    update(game: Game) {
      if (game.caught !== shownCount) { const up = game.caught > shownCount; shownCount = game.caught; n.textContent = String(shownCount); if (up) pop(); }
      const text = game.hint;
      if (text !== shownStatus) {
        shownStatus = text; statusEl.textContent = text;
        statusEl.animate([{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 320, easing: 'ease-out' });
      }
      const on = game.phase === 'bite';
      if (on !== promptOn) { promptOn = on; prompt.classList.toggle('on', on); }
      if (on) ring.style.strokeDashoffset = String(100 - game.hookLeft * 100);
      root.classList.toggle('busy', game.phase !== 'idle');
    },
    dispose() { root.remove(); },
  };
}
