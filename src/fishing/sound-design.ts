/** Deterministic offline foley synthesis. Each sound has several takes, rendered once. */
export type SoundName = 'cast' | 'splash' | 'nibble' | 'bite' | 'hook' | 'surface' | 'drop' | 'catch' | 'miss' | 'reel';
const durations: Record<SoundName, number> = { cast: .36, splash: .95, nibble: .22, bite: .55, hook: .28, surface: .6, drop: .36, catch: .7, miss: .48, reel: .065 };

export function renderSound(name: SoundName, sampleRate: number, take = 0): Float32Array {
  const out = new Float32Array(Math.ceil(durations[name] * sampleRate));
  let seed = 8137 + take * 977 + Object.keys(durations).indexOf(name) * 131;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const variation = .94 + random() * .12;
  const add = (start: number, duration: number, sample: (t: number, u: number) => number) => {
    const offset = Math.round(start * sampleRate), n = Math.min(Math.ceil(duration * sampleRate), out.length - offset);
    for (let i = 0; i < n; i++) out[offset + i] += sample(i / sampleRate, i / n);
  };
  const modal = (at: number, duration: number, frequencies: number[], gain: number, decay = 7) => {
    const phases = frequencies.map(() => random() * Math.PI * 2);
    add(at, duration, (t, u) => {
      const attack = Math.min(1, t / .0025), envelope = attack * Math.exp(-u * decay) * Math.pow(1-u, 2);
      let v = 0;
      frequencies.forEach((f, i) => { v += Math.sin(2 * Math.PI * f * variation * t + phases[i]) * Math.exp(-u * i * 3) / (1 + i * 1.7); });
      return v * envelope * gain;
    });
  };
  const texture = (at: number, duration: number, cutoff: number, gain: number, attack = .015, decay = 4, highpass = 0) => {
    let low = 0, floor = 0;
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate), b = 1 - Math.exp(-2 * Math.PI * highpass / sampleRate);
    add(at, duration, (t, u) => {
      low += ((random() * 2 - 1) - low) * a; floor += (low - floor) * b;
      return (low - floor) * Math.min(1, t / attack) * Math.exp(-u * decay) * Math.pow(1-u, 2) * gain;
    });
  };
  const droplet = (at: number, size: number, gain: number) => {
    const duration = .03 + size * .06, f = 450 + (1-size) * 1150;
    add(at, duration, (t, u) => Math.sin(2 * Math.PI * (f * variation * t + 450 * t * t)) * (1 - Math.exp(-u * 25)) * Math.exp(-u * 8) * gain);
    texture(at, duration * .6, 3800, gain * .45, .001, 8, 1100);
  };
  const water = (gain: number, size: number) => {
    texture(0, .4 * size, 3000, gain, .012, 3.2, 220);
    texture(.025, .85 * size, 520, gain * 1.2, .035, 3);
    modal(.008, .16 * size, [112, 178, 317], gain * .16, 8);
    for (let i = 0; i < Math.round(18 * size); i++) droplet(.02 + random() * .46 * size, random(), gain * (.05 + random() * .1));
  };
  const wood = (at: number, gain: number, hollow = false) => {
    modal(at, hollow ? .3 : .13, hollow ? [186, 347, 731, 1327] : [328, 811, 1683], gain, hollow ? 5 : 8);
    texture(at, .035, 4700, gain * .5, .001, 8, 700);
  };
  switch (name) {
    case 'cast':
      texture(0, .34, 4500, .26, .04, 2.2, 1300); texture(.01, .25, 500, .12, .03, 3); wood(.01, .035); break;
    case 'splash': water(.75, 1); break;
    case 'surface': water(.42, .66); break;
    case 'nibble': droplet(.005, .75, .25); droplet(.08 + random() * .03, .3, .09); break;
    case 'bite':
      // Two tactile rod knocks with line tension and a small water tug; no alarm oscillator.
      wood(.005, .43, true); wood(.165, .3, true);
      texture(.015, .46, 1400, .14, .035, 2.5, 260); droplet(.045, .8, .16); break;
    case 'hook':
      texture(0, .22, 3900, .28, .006, 4, 1100); wood(.012, .28); modal(.018, .2, [163, 391, 1170], .16); break;
    case 'drop': wood(.005, .48, true); water(.15, .3); break;
    case 'catch':
      wood(.005, .43, true); wood(.14, .23, true); water(.16, .6);
      texture(.04, .55, 1100, .08, .05, 3, 180); break;
    case 'miss':
      texture(0, .38, 1700, .18, .025, 2, 400); droplet(.06, .65, .14); break;
    case 'reel':
      // Short gear tooth contact: inharmonic metal modes, padded mechanical transient.
      modal(.001, .054, [1467, 2381, 4173], .19, 10); texture(0, .025, 4000, .12, .001, 8, 1800); break;
  }
  // Remove DC and tame peaks; retain each cue's designed relative loudness.
  let mean = 0, peak = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  for (let i = 0; i < out.length; i++) { out[i] -= mean; peak = Math.max(peak, Math.abs(out[i])); }
  if (peak > .8) for (let i = 0; i < out.length; i++) out[i] *= .8 / peak;
  // Fade the end to zero even for very short mechanical sounds.
  const fade = Math.min(out.length, Math.ceil(sampleRate * .008));
  for (let i = 0; i < fade; i++) out[out.length - fade + i] *= 1 - i / fade;
  return out;
}

export function createSoundBank(sampleRate = 44100) {
  return Object.fromEntries((Object.keys(durations) as SoundName[]).map(name => [name, Array.from({ length: 4 }, (_, take) => renderSound(name, sampleRate, take))])) as Record<SoundName, Float32Array[]>;
}
