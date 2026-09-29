/** Optional Web Audio. Decode once after a gesture; unavailable audio is silent. */
export function createAudio() {
  let muted = true;
  try { muted = localStorage.getItem('aquarium-sound') !== 'on'; } catch { /* Storage can be disabled. */ }
  let context: AudioContext | undefined, master: GainNode | undefined, bubblesGain: GainNode | undefined;
  let glass: AudioBuffer | undefined, bubbles: AudioBuffer | undefined, loop: AudioBufferSourceNode | undefined;
  let loading: Promise<void> | undefined;
  const voices = new Set<AudioBufferSourceNode>();
  async function gesture() {
    try {
      context ??= new AudioContext();
      await context.resume();
      if (!master) { master = context.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(context.destination); }
      loading ??= (async () => {
        const decode = async (name: string) => context!.decodeAudioData(await (await fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`)).arrayBuffer());
        [glass, bubbles] = await Promise.all([decode('glass-breaking'), decode('bubbles')]);
      })().catch(() => {});
      await loading;
    } catch { /* Web Audio is optional. */ }
  }
  async function play(full: boolean) {
    await gesture(); if (muted || !context || !master || !glass) return;
    try {
      const source = context.createBufferSource(), gain = context.createGain(); source.buffer = glass;
      source.connect(gain); gain.connect(master); gain.gain.value = full ? 0.65 : 0.28;
      const duration = full ? glass.duration : Math.min(0.6, glass.duration), now = context.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      source.start(0, 0, duration); voices.add(source); source.onended = () => { voices.delete(source); gain.disconnect(); source.disconnect(); };
    } catch { /* Missing/blocked playback must not interrupt simulation. */ }
  }
  return { gesture, play, get muted() { return muted; }, toggle() {
    muted = !muted; try { localStorage.setItem('aquarium-sound', muted ? 'off' : 'on'); } catch { /* Optional preference. */ }
    void gesture().then(() => { if (context && master) master.gain.setTargetAtTime(muted ? 0 : 0.7, context.currentTime, 0.04); });
  }, update(strength: number, timeScale: number) {
    if (!context || !master || !bubbles) return;
    try {
      if (strength > 0 && !loop && !muted) {
        loop = context.createBufferSource(); loop.buffer = bubbles; loop.loop = true;
        bubblesGain = context.createGain(); bubblesGain.gain.value = 0; loop.connect(bubblesGain); bubblesGain.connect(master); loop.start();
      }
      if (loop) {
        loop.playbackRate.value = timeScale;
        bubblesGain!.gain.setTargetAtTime(Math.min(0.4, strength * 0.3), context.currentTime, 0.12);
        if (strength === 0) { loop.stop(); loop.disconnect(); loop = undefined; bubblesGain?.disconnect(); }
      }
    } catch { /* Audio device may disappear. */ }
  }, reset() { for (const voice of voices) { try { voice.stop(); } catch { /* Already ended. */ } } voices.clear(); } };
}
