/** Decode while suspended; only a user gesture resumes audible playback. */
export function audibleRange(buffer: AudioBuffer) {
  let first = buffer.length, last = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const samples = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > 0.01) { first = Math.min(first, i); last = Math.max(last, i); }
  }
  return { offset: first === buffer.length ? 0 : Math.max(0, first / buffer.sampleRate - 0.01), end: Math.min(buffer.duration, last / buffer.sampleRate + 0.03) };
}
export function createAudio(currentFrame: () => number = () => -1) {
  let muted = false;
  try { muted = localStorage.getItem('aquarium-sound') === 'off'; } catch { /* Optional preference. */ }
  let context: AudioContext | undefined, master: GainNode | undefined, bubblesGain: GainNode | undefined;
  let glass: AudioBuffer | undefined, bubbles: AudioBuffer | undefined, reversed: AudioBuffer | undefined, loop: AudioBufferSourceNode | undefined;
  let glassRange = { offset: 0, end: 0 }, bubbleRange = { offset: 0, end: 0 };
  let generation = 0, ready = false;
  let lastPlay: { kind: string; at: number; offset: number; gain: number; frame: number } | null = null;
  const voices = new Set<AudioBufferSourceNode>();
  const loading = (async () => {
    try {
      context = new AudioContext(); void context.suspend().catch(() => {});
      master = context.createGain(); master.gain.value = muted ? 0 : 1; master.connect(context.destination);
      const decode = async (name: string) => {
        const response = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`);
        if (!response.ok) throw new Error('Audio unavailable');
        return context!.decodeAudioData(await response.arrayBuffer());
      };
      [glass, bubbles] = await Promise.all([decode('glass-breaking'), decode('bubbles')]);
      glassRange = audibleRange(glass); bubbleRange = audibleRange(bubbles);
      const start = Math.floor(glassRange.offset * glass.sampleRate), end = Math.ceil(glassRange.end * glass.sampleRate);
      reversed = context.createBuffer(glass.numberOfChannels, Math.max(1, end - start), glass.sampleRate);
      for (let c = 0; c < glass.numberOfChannels; c++) {
        const source = glass.getChannelData(c), dest = reversed.getChannelData(c);
        for (let i = 0; i < dest.length; i++) dest[i] = source[end - 1 - i] ?? 0;
      }
      ready = true;
    } catch { /* Optional audio: missing files/device never interrupt the scene. */ }
  })();
  function gesture() {
    // Call resume synchronously from pointerdown, before processing the impact.
    try { return context?.resume().catch(() => {} ) ?? Promise.resolve(); } catch { return Promise.resolve(); }
  }
  function playKind(kind: 'crack' | 'shatter' | 'rewind'): Promise<void> {
    const requested = generation;
    const start = () => {
      if (requested !== generation || muted || !ready || !context || !master || !glass || !reversed) return;
      try {
        const source = context.createBufferSource(), gain = context.createGain(), reverse = kind === 'rewind';
        source.buffer = reverse ? reversed : glass;
        const offset = reverse ? 0 : glassRange.offset, peak = reverse ? 0.18 : kind === 'crack' ? 0.9 : 1;
        const duration = reverse ? reversed.duration : Math.min(glassRange.end - offset, kind === 'crack' ? 0.45 : Infinity);
        const rate = reverse ? reversed.duration / 1.6 : kind === 'crack' ? 0.95 + Math.random() * 0.15 : 1;
        source.playbackRate.value = rate; source.connect(gain); gain.connect(master);
        const now = context.currentTime;
        gain.gain.setValueAtTime(0.001, now); gain.gain.linearRampToValueAtTime(peak, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.01, duration / rate));
        source.start(now, offset, duration); voices.add(source);
        lastPlay = { kind, at: performance.now(), offset, gain: peak, frame: currentFrame() };
        source.onended = () => { voices.delete(source); gain.disconnect(); source.disconnect(); };
      } catch { /* Playback can fail if the audio device disappears. */ }
    };
    // A source can be scheduled while resume is pending. Register it immediately
    // so the impact frame owns playback and Reset can stop it before the device wakes.
    if (ready) { void gesture(); start(); return Promise.resolve(); }
    return Promise.all([gesture(), loading]).then(start);
  }
  function stopLoop() { try { loop?.stop(); loop?.disconnect(); bubblesGain?.disconnect(); } catch { /* Already stopped. */ } loop = undefined; }
  return {
    loading, gesture, play: (full: boolean) => playKind(full ? 'shatter' : 'crack'), rewind: () => playKind('rewind'),
    get muted() { return muted; }, get diagnostics() { return { muted, ready, lastPlay: lastPlay && { ...lastPlay }, offsets: { glass: glassRange.offset, bubbles: bubbleRange.offset } }; },
    toggle() {
      muted = !muted; try { localStorage.setItem('aquarium-sound', muted ? 'off' : 'on'); } catch { /* Optional preference. */ }
      void gesture(); if (context && master) master.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.04);
    },
    update(strength: number, timeScale: number) {
      if (!context || !master || !bubbles || context.state !== 'running') return;
      try {
        if (strength > 0 && !loop && !muted) {
          loop = context.createBufferSource(); loop.buffer = bubbles; loop.loop = true; loop.loopStart = bubbleRange.offset; loop.loopEnd = bubbleRange.end;
          bubblesGain = context.createGain(); bubblesGain.gain.value = 0; loop.connect(bubblesGain); bubblesGain.connect(master); loop.start(0, bubbleRange.offset);
        }
        if (loop) {
          loop.playbackRate.value = timeScale; bubblesGain!.gain.setTargetAtTime(Math.min(0.4, strength * 0.3), context.currentTime, 0.12);
          if (strength === 0 || muted) stopLoop();
        }
      } catch { /* Optional audio device. */ }
    },
    reset() { generation++; stopLoop(); for (const voice of voices) { try { voice.stop(); } catch { /* Ended. */ } } voices.clear(); },
  };
}
