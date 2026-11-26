/** Tiny WebAudio synth: no audio files needed. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = localStorage.getItem('armorline.muted') === '1';

export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem('armorline.muted', m ? '1' : '0');
  if (master) master.gain.value = m ? 0 : 0.5;
}

function noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
  if (!ctx || !master || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur);
}

function tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

/** `near` 0..1 scales volume by distance to the listener. */
export const sfx = {
  fire(near = 1) {
    noise(0.5, 900, 0.7, 0.9 * near);
    tone(120, 40, 0.35, 0.8 * near);
  },
  pen(near = 1) {
    noise(0.25, 2500, 1, 0.6 * near, 'bandpass');
    tone(300, 90, 0.2, 0.5 * near, 'square');
  },
  ricochet(near = 1) {
    tone(2400, 900, 0.35, 0.25 * near, 'triangle');
  },
  blocked(near = 1) {
    tone(500, 300, 0.15, 0.35 * near, 'square');
    noise(0.12, 3000, 2, 0.3 * near, 'bandpass');
  },
  explode(near = 1) {
    noise(1.4, 400, 0.5, 1 * near);
    tone(80, 25, 1, 0.9 * near);
  },
  reload() {
    tone(900, 1200, 0.06, 0.15, 'square');
  },
  click() {
    tone(700, 500, 0.05, 0.15, 'triangle');
  },
  reward() {
    tone(500, 900, 0.15, 0.25, 'triangle');
    setTimeout(() => tone(700, 1300, 0.25, 0.25, 'triangle'), 120);
  },
};
