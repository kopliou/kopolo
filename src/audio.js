// Synthesised sound effects (Web Audio): glassy pings, noise bursts and low rumbles, no audio files.

const PENTA = [659, 784, 880, 988, 1175, 1319];

// Minimum seconds between two plays of the same sound.
const GAP = { hit: 0.05, pickup: 0.045, nodeHit: 0.06, kill: 0.05, mobShot: 0.08, bossShot: 0.12, boom: 0.06, spark: 0.1 };

const SOUNDS = {
  shard: (s) => s.tone(900, 420, 0.07, 'square', 0.05),
  fan: (s) => { s.noise(0.09, 0.16, 1800, 0.8); s.tone(320, 160, 0.09, 'square', 0.05); },
  needle: (s) => s.tone(1400, 900, 0.035, 'triangle', 0.05),
  prism: (s) => { s.tone(1600, 260, 0.2, 'sawtooth', 0.06); s.tone(2400, 1200, 0.12, 'sine', 0.05); },
  comet: (s) => { s.tone(220, 70, 0.22, 'sine', 0.16); s.noise(0.12, 0.1, 500, 0.7); },
  swarm: (s) => s.tone(700, 1150, 0.09, 'sine', 0.06),
  hit: (s) => s.noise(0.04, 0.07, 3200, 1.5),
  spark: (s) => s.noise(0.03, 0.03, 5000, 2),
  nodeHit: (s) => s.noise(0.05, 0.07, 1400, 1.2),
  nodeBreak: (s) => { s.noise(0.2, 0.14, 2400, 0.7, 'highpass'); s.tone(520, 300, 0.12, 'triangle', 0.06); },
  kill: (s) => {
    s.noise(0.18, 0.13, 4200, 0.6, 'highpass');
    s.tone(1800 + Math.random() * 1400, 1200, 0.13, 'sine', 0.05);
    s.tone(2600 + Math.random() * 1200, 1900, 0.1, 'sine', 0.035, 0.04);
  },
  pickup: (s) => s.tone(PENTA[(Math.random() * PENTA.length) | 0], 0, 0.1, 'sine', 0.05),
  hurt: (s) => { s.tone(190, 80, 0.2, 'sawtooth', 0.12); s.noise(0.12, 0.1, 700, 0.8); },
  dash: (s) => s.noise(0.14, 0.09, 1500, 0.6),
  boom: (s) => { s.tone(130, 38, 0.36, 'sine', 0.22); s.noise(0.3, 0.16, 380, 0.5, 'lowpass'); },
  plant: (s) => s.tone(330, 520, 0.13, 'sine', 0.07),
  harvest: (s) => PENTA.slice(0, 3).forEach((f, i) => s.tone(f, 0, 0.12, 'sine', 0.06, i * 0.06)),
  eat: (s) => { s.tone(520, 0, 0.09, 'triangle', 0.07); s.tone(780, 0, 0.12, 'triangle', 0.07, 0.08); },
  swap: (s) => s.tone(600, 800, 0.05, 'triangle', 0.04),
  upgrade: (s) => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, 0, 0.16, 'triangle', 0.07, i * 0.07)),
  recall: (s) => { s.tone(300, 1200, 0.5, 'sine', 0.08); s.noise(0.4, 0.05, 2600, 0.6); },
  mobShot: (s) => s.tone(520, 300, 0.08, 'triangle', 0.04),
  bossShot: (s) => s.tone(300, 170, 0.12, 'triangle', 0.06),
  bossLaser: (s) => { s.tone(90, 60, 0.9, 'sawtooth', 0.1); s.tone(1800, 600, 0.5, 'sine', 0.03); },
  bossStart: (s) => { s.tone(70, 45, 1.1, 'sawtooth', 0.16); s.tone(105, 60, 1.1, 'sawtooth', 0.08); s.noise(0.9, 0.08, 300, 0.5, 'lowpass'); },
  bossPhase: (s) => { s.tone(90, 50, 0.6, 'sawtooth', 0.14); s.noise(0.4, 0.1, 900, 0.5); },
  bossDead: (s) => {
    s.noise(0.9, 0.2, 3000, 0.5, 'highpass');
    s.tone(110, 30, 0.9, 'sine', 0.22);
    [523, 659, 784, 1047, 1319].forEach((f, i) => s.tone(f, 0, 0.5, 'sine', 0.07, 0.15 + i * 0.09));
  },
  death: (s) => [440, 330, 247, 165].forEach((f, i) => s.tone(f, f * 0.8, 0.3, 'triangle', 0.09, i * 0.14)),
};

// Game event -> sound name (or a function picking one).
const EVENTS = {
  shoot: (e) => e.weapon, hit: 'hit', spark: 'spark', nodeHit: 'nodeHit', nodeBreak: 'nodeBreak', kill: 'kill', pickup: 'pickup',
  hurt: 'hurt', dash: 'dash', boom: 'boom', plant: 'plant', harvest: 'harvest', eat: 'eat', swap: 'swap', upgrade: 'upgrade',
  craft: 'upgrade', recall: 'recall', respawn: 'recall', mobShot: 'mobShot', bossShot: 'bossShot', bossLaser: 'bossLaser',
  bossStart: 'bossStart', bossPhase: 'bossPhase', bossDead: 'bossDead', death: 'death',
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffer = null;
    this.muted = false;
    this.last = new Map();
  }

  // Browsers only allow audio after a user gesture, so this is called from the first click.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        this.buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const d = this.buffer.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null; // the game is fully playable without sound
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  tone(from, to, dur, type, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, freq, q, type = 'bandpass', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.buffer;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  play(name) {
    const make = SOUNDS[name];
    if (!make || !this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < (GAP[name] ?? 0.03)) return;
    this.last.set(name, now);
    make(this);
  }

  onEvent(e) {
    const name = EVENTS[e.type];
    if (name) this.play(typeof name === 'function' ? name(e) : name);
  }
}
