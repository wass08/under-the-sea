import { Vector3 } from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';
import type { GameEvent, Phase } from './game';
import { createSoundBank } from './sound-design';
import type { SoundName } from './sound-design';

/** Layered foley with four takes per cue, spatial panning and soft outdoor reflections. */
export function createAudio(camera: PerspectiveCamera) {
  const sampleRate = 44100, designs = createSoundBank(sampleRate);
  let ctx: AudioContext | null = null, master: GainNode | null = null, dry: GainNode | null = null, wet: GainNode | null = null;
  let bank: Record<SoundName, AudioBuffer[]> | null = null, muted = false, reelAt = 0;
  const active = new Set<AudioBufferSourceNode>(), projected = new Vector3();
  const takes: Partial<Record<SoundName, number>> = {};
  // A dock button (src/ui.ts moves it into the behaviour dock): speaker icon with waves, crossed out when muted.
  const button = document.createElement('button'); button.className = 'dock-item'; button.id = 'dock-sound'; button.type = 'button';
  document.body.appendChild(button);
  const SPEAKER = '<path d="M6 13h4l6-5v16l-6-5H6z"/>';
  const refresh = () => {
    const icon = muted ? `${SPEAKER}<path d="M21 13l6 6M27 13l-6 6"/>` : `${SPEAKER}<path d="M20.5 12.5a5 5 0 0 1 0 7M23.5 9.5a9 9 0 0 1 0 13"/>`;
    button.innerHTML = `<span class="dock-icon"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><span class="dock-label">${muted ? 'Sound off' : 'Sound'}</span><kbd>S</kbd>`;
    button.classList.toggle('active', !muted);
    button.title = muted ? 'Enable sound (S)' : 'Mute sound (S)';
    button.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
    button.setAttribute('aria-pressed', String(!muted));
  };
  refresh();
  function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = muted ? 0 : .78;
      const highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 65;
      const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.knee.value = 9;
      limiter.ratio.value = 3; limiter.attack.value = .006; limiter.release.value = .16;
      master.connect(highpass); highpass.connect(limiter); limiter.connect(ctx.destination);
      dry = ctx.createGain(); dry.gain.value = .9; dry.connect(master);
      wet = ctx.createGain(); wet.gain.value = .12;
      const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 2100; wet.connect(soft);
      for (const [seconds, level, pan] of [[.019, .5, -.45], [.043, .28, .5], [.079, .12, -.2]]) {
        const delay = ctx.createDelay(.2), gain = ctx.createGain(), panner = ctx.createStereoPanner();
        delay.delayTime.value = seconds; gain.gain.value = level; panner.pan.value = pan;
        soft.connect(delay); delay.connect(gain); gain.connect(panner); panner.connect(master);
      }
      bank = Object.fromEntries(Object.entries(designs).map(([name, variants]) => [name, variants.map(samples => {
        const buffer = ctx!.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0); return buffer;
      })])) as Record<SoundName, AudioBuffer[]>;
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  const toggle = () => { unlock(); muted = !muted; master!.gain.setTargetAtTime(muted ? 0 : .78, ctx!.currentTime, .025); refresh(); };
  button.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  addEventListener('keydown', e => {
    if (e.code !== 'KeyS' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest?.('input, textarea, .tp-dfwv')) return;
    e.preventDefault(); toggle();
  });
  function play(name: SoundName, volume = 1, pan = 0) {
    if (!ctx || !bank || !dry || !wet || muted || ctx.state !== 'running' || active.size >= 16) return;
    // Avoid immediately repeating a take. Continuous reel ticks use the same prepared buffers.
    const previous = takes[name] ?? -1, take = (previous + 1 + Math.floor(Math.random() * 3)) % 4; takes[name] = take;
    const source = ctx.createBufferSource(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    source.buffer = bank[name][take]; source.playbackRate.value = .97 + Math.random() * .06;
    gain.gain.value = volume * (.94 + Math.random() * .12); panner.pan.value = Math.max(-.65, Math.min(.65, pan));
    source.connect(gain); gain.connect(panner); panner.connect(dry); panner.connect(wet);
    active.add(source); source.start();
    source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); panner.disconnect(); };
  }
  return {
    event(e: GameEvent) {
      const pan = projected.copy(e.pos).project(camera).x * .5;
      switch (e.type) {
        case 'release': play('cast', .8, pan); break;
        case 'splash': play('splash', .85, pan); break;
        case 'nibble': play('nibble', .3, pan); break;
        case 'bite': play('bite', 1, pan); break;
        case 'hook': play('hook', .8, pan); break;
        case 'surface': case 'liftout': play('surface', .7, pan); break;
        case 'drop': play('drop', .6, pan); break;
        case 'catch': play('catch', .75, pan); break;
        case 'miss': play('miss', .6, pan); break;
      }
    },
    update(realDt: number, phase: Phase) {
      if (phase === 'reeling' || phase === 'retrieving') {
        reelAt -= realDt;
        if (reelAt <= 0) { play('reel', .2); reelAt = .07 + Math.random() * .035; }
      } else reelAt = 0;
    },
    get state() { return { muted, context: ctx?.state ?? 'locked', voices: active.size }; },
  };
}
