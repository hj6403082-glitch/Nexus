import { audio } from './AudioEngine';

/**
 * THE MACHINE UNDER THE VOICE.
 *
 * What we cannot do, and why this exists:
 *
 * `speechSynthesis` renders straight to the output device. Its audio never
 * enters the page's AudioContext, there is no MediaStream to tap, and an
 * AnalyserNode pointed at it sees silence. So the obvious approach — run the
 * TTS through a formant shifter, a ring modulator and a plate — is not
 * available in a browser at all. No amount of Web Audio will filter a voice
 * the page cannot hear.
 *
 * What is available is everything AROUND it. The utterance carries a pitch and
 * a rate; the clause splitter controls the cadence; and this file supplies a
 * layer that plays UNDER the speech, in the page's own graph, gated on the
 * same envelope that drives the jaw. The ear fuses the two into one source, so
 * a plain synthetic voice acquires a chassis it does not actually have.
 *
 * Three components, all derived from one level signal:
 *
 *   SUB      a sine an octave and a half below the speaking range. It is what
 *            makes the voice feel physically large rather than merely low.
 *   METAL    two detuned saws through a bandpass, ring-modulated at 61 Hz.
 *            Ring modulation is the classic robot timbre because it produces
 *            sum-and-difference partials that are not harmonically related to
 *            anything — the ear hears a machine, not a throat.
 *   AIR      filtered noise, only on the loud parts, which reads as the hiss
 *            of a transmission rather than breath.
 *
 * None of it is a voice on its own. Muted, the TTS still speaks and the
 * interface still works — this is character, not function.
 */

interface Chain {
  ctx: AudioContext;
  sub: OscillatorNode;
  subGain: GainNode;
  metalGain: GainNode;
  airGain: GainNode;
  out: GainNode;
  stop: () => void;
}

let chain: Chain | null = null;

/** Built lazily, and only after a gesture has unlocked the context. */
function build(): Chain | null {
  const ctx = audio.context;
  const destination = audio.voiceBus();
  if (!ctx || !destination) return null;

  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(destination);

  // --- sub ------------------------------------------------------------------
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 58;
  const subGain = ctx.createGain();
  subGain.gain.value = 0;
  sub.connect(subGain).connect(out);

  // --- metal ----------------------------------------------------------------
  // A ring modulator is a multiplier, and Web Audio has no multiply node — but
  // a GainNode IS a multiplier, so driving its gain with an audio-rate
  // oscillator is exactly ring modulation.
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = 61;

  const ring = ctx.createGain();
  ring.gain.value = 0; // the oscillator below supplies the whole signal
  carrier.connect(ring.gain);

  const sawA = ctx.createOscillator();
  sawA.type = 'sawtooth';
  sawA.frequency.value = 104;
  sawA.detune.value = -7;
  const sawB = ctx.createOscillator();
  sawB.type = 'sawtooth';
  sawB.frequency.value = 104;
  sawB.detune.value = 9;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 780;
  band.Q.value = 1.6;

  sawA.connect(band);
  sawB.connect(band);
  band.connect(ring);

  const metalGain = ctx.createGain();
  metalGain.gain.value = 0;
  ring.connect(metalGain).connect(out);

  // --- air ------------------------------------------------------------------
  const noiseLength = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  const hiss = ctx.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.frequency.value = 2600;
  hiss.Q.value = 0.8;

  const airGain = ctx.createGain();
  airGain.gain.value = 0;
  noise.connect(hiss).connect(airGain).connect(out);

  sub.start(now);
  carrier.start(now);
  sawA.start(now);
  sawB.start(now);
  noise.start(now);

  const stop = () => {
    for (const node of [sub, carrier, sawA, sawB]) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    try {
      noise.stop();
    } catch {
      /* already stopped */
    }
    out.disconnect();
  };

  return { ctx, sub, subGain, metalGain, airGain, out, stop };
}

/**
 * Drive the layer from the speech envelope, once per frame.
 *
 * `setTargetAtTime` rather than direct assignment: a gain stepped per frame
 * clicks audibly at 60 Hz, and the clicks are the one thing that would give
 * away that this is a separate source from the voice.
 */
export function driveVoiceCharacter(level: number): void {
  if (!chain) chain = build();
  if (!chain) return;

  const { ctx, sub, subGain, metalGain, airGain } = chain;
  const t = ctx.currentTime;

  subGain.gain.setTargetAtTime(level * 0.16, t, 0.035);
  metalGain.gain.setTargetAtTime(level * 0.055, t, 0.03);
  // Air only on the loud parts — under a consonant it just sounds like a fault.
  airGain.gain.setTargetAtTime(Math.max(0, level - 0.45) * 0.03, t, 0.05);

  // A slow wander in the sub, so the layer is not a dead tone sitting under a
  // moving voice. Small enough that it reads as instability, not as pitch.
  sub.frequency.setTargetAtTime(58 + Math.sin(t * 0.7) * 1.6, t, 0.2);
}

/** Silence the layer without tearing it down; speech starts again often. */
export function restVoiceCharacter(): void {
  if (!chain) return;
  const t = chain.ctx.currentTime;
  chain.subGain.gain.setTargetAtTime(0, t, 0.08);
  chain.metalGain.gain.setTargetAtTime(0, t, 0.08);
  chain.airGain.gain.setTargetAtTime(0, t, 0.08);
}

/** Release the oscillators. Called when the page is going away. */
export function disposeVoiceCharacter(): void {
  chain?.stop();
  chain = null;
}
