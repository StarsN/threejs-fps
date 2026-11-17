// Sound, synthesised with WebAudio and nothing else: no audio files ship
// with the game. Everything is a short burst of filtered noise or a sine
// blip, built lazily after the first user gesture (browsers block audio
// before one).
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;

  function ensure() {
    if (context) return context;
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      const length = context.sampleRate;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      context = null;
    }
    return context;
  }

  function noise(duration, filterFreq, gain, when = 0) {
    if (!ensure() || muted) return;
    const t = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t, Math.random() * 0.5, duration);
    source.stop(t + duration);
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!ensure() || muted) return;
    const t = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() {
      const ctx = ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind, distance = 0) {
      const atten = Math.max(0.12, 1 - distance / 55);
      if (kind === 'sniper') {
        noise(0.28, 900, 0.5 * atten);
        tone(160, 0.16, 0.35 * atten, 'sine', 55);
      } else if (kind === 'shotgun') {
        noise(0.22, 1400, 0.55 * atten);
        tone(120, 0.14, 0.3 * atten, 'sine', 50);
      } else if (kind === 'smg') {
        noise(0.09, 2600, 0.32 * atten);
        tone(210, 0.07, 0.18 * atten, 'square', 90);
      } else if (kind === 'rifle') {
        noise(0.14, 1900, 0.42 * atten);
        tone(170, 0.1, 0.24 * atten, 'sine', 70);
      } else {
        noise(0.1, 2200, 0.34 * atten);
        tone(230, 0.08, 0.2 * atten, 'square', 100);
      }
    },
    dry() {
      tone(1400, 0.03, 0.12, 'square');
    },
    reload() {
      tone(900, 0.03, 0.14, 'square');
      tone(620, 0.03, 0.14, 'square', 0, 0.16);
      tone(1050, 0.04, 0.16, 'square', 0, 0.55);
    },
    hit() {
      tone(2400, 0.04, 0.16, 'sine');
    },
    kill() {
      tone(1320, 0.07, 0.18, 'sine');
      tone(1760, 0.1, 0.18, 'sine', 0, 0.07);
    },
    hurt() {
      tone(220, 0.12, 0.22, 'sawtooth', 120);
    },
    buy() {
      tone(1560, 0.06, 0.16, 'sine');
      tone(2090, 0.09, 0.16, 'sine', 0, 0.06);
    },
    denied() {
      tone(320, 0.09, 0.16, 'square', 240);
    },
    beep(final = false) {
      tone(final ? 1750 : 1250, 0.07, 0.2, 'sine');
    },
    plant() {
      tone(980, 0.08, 0.18, 'sine');
      tone(980, 0.08, 0.18, 'sine', 0, 0.14);
    },
    explosion() {
      noise(1.1, 420, 0.9);
      tone(90, 0.9, 0.6, 'sine', 32);
      noise(0.4, 3000, 0.35, 0.05);
    },
    roundWin() {
      tone(523, 0.12, 0.2, 'sine');
      tone(659, 0.12, 0.2, 'sine', 0, 0.12);
      tone(784, 0.22, 0.22, 'sine', 0, 0.24);
    },
    roundLose() {
      tone(392, 0.14, 0.2, 'sine');
      tone(330, 0.14, 0.2, 'sine', 0, 0.14);
      tone(262, 0.28, 0.2, 'sine', 0, 0.28);
    },
    bounce() {
      tone(300, 0.04, 0.12, 'sine', 180);
    },
  };
}
