import type { Game } from './game';

// Line icons in the dock's style (32-unit grid, 1.6 stroke).
const FISH_ICON = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16c4-6 10-8 15-6 2.5 1 4.5 3 5.5 6-1 3-3 5-5.5 6-5 2-11 0-15-6z"/><path d="M24.5 16 29 11v10z"/><circle cx="9" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M13 10.5c1.4 3.2 1.4 7.8 0 11" opacity=".55"/></svg>`;
const WEIGHT_ICON = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="16" cy="8" r="2.4"/><path d="M10.5 12h11l3.5 14H7z"/><path d="M13 19h6" opacity=".55"/></svg>`;
const HOOK_ICON = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="19" cy="5.5" r="2"/><path d="M19 7.5V20a5.5 5.5 0 0 1-11 0v-4.5l3.5 3.5"/><path d="M24 12.5c1.4 1.6 1.4 4.4 0 6M27 10c2.6 3.2 2.6 8.8 0 12" opacity=".55"/></svg>`;
/** "182 g" / "1.24 kg". */
export const formatGrams = (g: number) => g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;

/** DOM overlay: a dock-style panel (catch count, total weight, status), a catch card, and the "Fish on!" hook prompt (same glass panel). */
export function createHud(hook: () => void) {
  const root = document.createElement('div');
  root.className = 'fishing-hud';
  root.innerHTML = `
    <div class="fh-pill">
      <div class="fh-stats">
        <div class="fh-cell fh-count"><span class="fh-icon">${FISH_ICON}</span><span class="fh-cell-text"><b class="fh-n">0</b><span class="fh-label">Caught</span></span></div>
        <span class="fh-sep" aria-hidden="true"></span>
        <div class="fh-cell fh-weight"><span class="fh-icon">${WEIGHT_ICON}</span><span class="fh-cell-text"><b class="fh-w">0 g</b><span class="fh-label">Total weight</span></span></div>
      </div>
      <div class="fh-status"><span class="fh-status-text">Click the water to cast</span></div>
    </div>
    <div class="fh-catch" aria-live="polite"></div>
    <div class="fh-bite-announcement" role="status" aria-live="assertive"></div>
    <div class="fh-marker" aria-hidden="true"></div>
    <button class="fh-prompt" type="button" aria-label="Hook fish" hidden>
      <span class="fh-cell fh-prompt-main"><span class="fh-icon">${HOOK_ICON}</span><span class="fh-cell-text"><b class="fh-prompt-title">Fish on!</b><span class="fh-label">Click or press <kbd>Space</kbd></span></span></span>
      <span class="fh-sep" aria-hidden="true"></span>
      <span class="fh-cell fh-prompt-timer"><span class="fh-cell-text"><b class="fh-time">0.0s</b><span class="fh-label">to hook</span></span></span>
      <span class="fh-bar" aria-hidden="true"><i class="fh-bar-fg"></i></span>
    </button>`;
  document.body.appendChild(root);
  const w = root.querySelector<HTMLElement>('.fh-w')!, card = root.querySelector<HTMLElement>('.fh-catch')!;
  let total = 0;
  const n = root.querySelector<HTMLElement>('.fh-n')!, statusEl = root.querySelector<HTMLElement>('.fh-status-text')!;
  const pill = root.querySelector<HTMLElement>('.fh-pill')!, count = root.querySelector<HTMLElement>('.fh-count')!;
  const prompt = root.querySelector<HTMLElement>('.fh-prompt')!, bar = root.querySelector<HTMLElement>('.fh-bar-fg')!;

  const marker = root.querySelector<HTMLElement>('.fh-marker')!, time = root.querySelector<HTMLElement>('.fh-time')!;
  const announcement = root.querySelector<HTMLElement>('.fh-bite-announcement')!;
  prompt.addEventListener('click', hook);
  let shownCount = 0, shownStatus = 'Click the water to cast', promptOn = false;
  function pop() {
    n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.7)', color: '#9fe6ff' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
    count.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    pill.animate([{ boxShadow: '0 0 0 0 #9fe6ff88' }, { boxShadow: '0 0 0 14px #9fe6ff00' }], { duration: 700, easing: 'ease-out' });
    const plus = document.createElement('span'); plus.className = 'fh-plus'; plus.textContent = '+1'; count.appendChild(plus);
    plus.animate([{ opacity: 0, transform: 'translateY(4px) scale(.7)' }, { opacity: 1, transform: 'translateY(-10px) scale(1)', offset: 0.25 }, { opacity: 0, transform: 'translateY(-26px) scale(1)' }], { duration: 900, easing: 'ease-out' }).onfinish = () => plus.remove();
  }
  return {
    /** A fish landed in the creel: add its weight and show a short catch card. */
    addCatch(grams: number) {
      total += grams; w.textContent = formatGrams(total);
      w.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)', color: '#ffdf9a' }, { transform: 'scale(1)' }], { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1.2)' });
      card.innerHTML = `<span class="fh-icon">${FISH_ICON}</span><span class="fh-cell-text"><b>Cá chuồn</b><span class="fh-label">${formatGrams(grams)} · flying fish</span></span>`;
      card.getAnimations().forEach(a => a.cancel());
      card.animate([{ opacity: 0, transform: 'translate(-50%, -6px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.12 }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.82 }, { opacity: 0, transform: 'translate(-50%, -4px) scale(.98)' }], { duration: 3200, easing: 'ease-out', fill: 'both' });
    },
    update(game: Game, anchor?: { x: number; y: number }) {
      if (game.caught !== shownCount) { const up = game.caught > shownCount; shownCount = game.caught; n.textContent = String(shownCount); if (up) pop(); }
      const text = game.hint;
      if (text !== shownStatus) {
        shownStatus = text; statusEl.textContent = text;
        statusEl.parentElement!.hidden = !text; // no empty band in the panel between messages
        statusEl.animate([{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 320, easing: 'ease-out' });
      }
      const on = game.phase === 'bite';
      if (on !== promptOn) {
        promptOn = on; prompt.hidden = !on; prompt.classList.toggle('on', on);
        root.classList.toggle('bite', on);
        announcement.textContent = on ? 'Fish on! Click or press Space to hook it.' : '';
      }
      if (on) {
        // A stable screen position is easy to spot; the separate marker locates the bobber.
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, game.hookLeft))})`;
        time.textContent = `${(game.hookLeft * game.hookWindow).toFixed(1)}s`;
        const visible = anchor && anchor.x >= 0 && anchor.x <= innerWidth && anchor.y >= 0 && anchor.y <= innerHeight;
        marker.style.display = visible ? 'block' : 'none';
        if (visible) { marker.style.left = anchor!.x + 'px'; marker.style.top = anchor!.y + 'px'; }
      } else marker.style.display = 'none';
      root.classList.toggle('busy', game.phase !== 'idle');
    },
    dispose() { root.remove(); },
  };
}
