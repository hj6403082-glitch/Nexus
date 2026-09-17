import { clamp01 } from '@/core/math/util';

/**
 * Everything audible in NEXUS. No samples, no network: the entire soundscape is
 * synthesised, which keeps the payload at zero bytes and lets every sound react
 * continuously to state rather than being a fixed clip.
 *
 * No voice here. Voice is Phase 2 and lives in `ai/speech.ts`.
 */
type UISound = 'tick' | 'confirm' | 'open' | 'close' | 'warn' | 'wake' | 'gesture';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padNodes: OscillatorNode[] = [];
  /** Voice panner — Phase 7 relocates this to the figure's face. */
  private voicePanner: PannerNode | null = null;
  private started = false;
  private muted = false;

  /** Browsers require a user gesture. Call from the first real interaction. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.started) {
      this.startPad();
      this.started = true;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.08);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** A very quiet, very slow synth pad. Three detuned saws through a low pass. */
  private startPad(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.6;

    // A slow LFO on the cutoff is what stops this reading as a held chord.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.037;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    // A low, open voicing. Fifths and octaves only — thirds make it a mood.
    for (const f of [55, 82.4, 110, 164.8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 9;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      osc.connect(g).connect(filter);
      osc.start();
      this.padNodes.push(osc);
    }

    filter.connect(gain).connect(this.master);
    this.padGain = gain;
  }

  /** Duck the pad while NEXUS speaks so the voice sits above it. */
  duck(amount: number): void {
    if (!this.padGain || !this.ctx) return;
    this.padGain.gain.setTargetAtTime(
      0.045 * (1 - clamp01(amount) * 0.7),
      this.ctx.currentTime,
      0.12,
    );
  }

  play(sound: UISound, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;

    const spec = SPECS[sound];
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, now);
    osc.frequency.exponentialRampToValueAtTime(spec.to, now + spec.dur);

    const gain = ctx.createGain();
    const peak = spec.gain * clamp01(intensity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);

    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + spec.dur + 0.02);
  }

  /**
   * Spatial voice. Phase 7 moves the source to the figure's face — but only in
   * DIRECTION. The panner attenuates with distance, and a head sitting four
   * metres out put the voice at half level; the distance is capped so the
   * direction is expressive and the level is not.
   */
  voiceNode(): PannerNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    if (!this.voicePanner) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.maxDistance = 2.2;
      p.rolloffFactor = 0.35;
      p.positionZ.value = -1;
      p.connect(this.master);
      this.voicePanner = p;
    }
    return this.voicePanner;
  }

  /** Direction only; distance is clamped to VOICE_RADIUS. */
  placeVoice(x: number, y: number, z: number): void {
    const p = this.voiceNode();
    if (!p || !this.ctx) return;
    const len = Math.hypot(x, y, z) || 1;
    const k = VOICE_RADIUS / len;
    const t = this.ctx.currentTime;
    p.positionX.setTargetAtTime(x * k, t, 0.15);
    p.positionY.setTargetAtTime(y * k, t, 0.15);
    p.positionZ.setTargetAtTime(z * k, t, 0.15);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  dispose(): void {
    this.padNodes.forEach((o) => o.stop());
    this.padNodes = [];
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

const VOICE_RADIUS = 1.4;

const SPECS: Record<UISound, { type: OscillatorType; from: number; to: number; dur: number; gain: number }> = {
  tick: { type: 'triangle', from: 1800, to: 1200, dur: 0.05, gain: 0.06 },
  confirm: { type: 'sine', from: 880, to: 1320, dur: 0.16, gain: 0.10 },
  open: { type: 'sine', from: 320, to: 760, dur: 0.34, gain: 0.12 },
  close: { type: 'sine', from: 700, to: 260, dur: 0.30, gain: 0.10 },
  warn: { type: 'square', from: 420, to: 300, dur: 0.22, gain: 0.07 },
  wake: { type: 'sine', from: 180, to: 640, dur: 0.85, gain: 0.14 },
  gesture: { type: 'triangle', from: 1400, to: 2100, dur: 0.07, gain: 0.07 },
};

export const audio = new AudioEngine();
