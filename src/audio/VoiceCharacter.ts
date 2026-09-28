import { audio } from './AudioEngine';

/**
 * THE MACHINE UNDER THE VOICE.
 *
 * What we cannot do, and why this exists:
 *
 * `speechSynthesis` renders straight to the output device. Its audio never
 * enters the page's AudioContext, there is no MediaStream to tap, and an
 * AnalyserNode pointed at it sees silence. So the obvious approach — run the
 * TTS through a formant shifter, a pitch shifter and a plate — is not
 * available in a browser at all. No amount of Web Audio will filter a voice
 * the page cannot hear.
 *
 * What is available is everything AROUND it. The utterance carries a pitch and
 * a rate; the clause splitter controls the cadence; and this file supplies a
 * layer that plays UNDER the speech, in the page's own graph, gated on the
 * same envelope that drives the jaw. The ear fuses the two into one source, so
 * a plain synthetic voice acquires a chassis it does not actually have.
 *
 * Four components, all derived from one level signal:
 *
 *   SUB      a sine at 44 Hz, well below anything the synthesiser produces.
 *            It is what makes the voice feel physically large rather than
 *            merely low, and it is the part a phone speaker will not
 *            reproduce at all — which is fine, it is not carrying meaning.
 *   GROWL    two saws a few cents apart, lowpassed hard and AMPLITUDE
 *            MODULATED at about 31 Hz. That modulation is the whole trick:
 *            vocal fry is a voice whose folds are flapping slowly enough to
 *            hear individually, and a slow tremolo on a low sawtooth is
 *            acoustically the same event. This is the gravel.
 *   GRIT     a waveshaper on the growl. Soft clipping adds odd harmonics that
 *            rise with level, so the voice roughens when it is loud and
 *            smooths when it is quiet, exactly as a strained one does.
 *   AIR      filtered noise on the loud parts only, which reads as the hiss of
 *            a transmission rather than as breath.
 *
 * There is deliberately NO RING MODULATOR here any more. Ring modulation is
 * the classic robot timbre because its partials are inharmonic — and that is
 * precisely the "systematic" quality this was asked to get away from. What
 * replaces it is roughness that is still harmonic, which the ear hears as a
 * big voice rather than as a machine.
 *
 * None of it is a voice on its own. Muted, the synthesiser still speaks and
 * the interface still works — this is character, not function.
 */

interface Chain {
  ctx: AudioContext;
  sub: OscillatorNode;
  subGain: GainNode;
  growlGain: GainNode;
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
  sub.frequency.value = 44;
  const subGain = ctx.createGain();
  subGain.gain.value = 0;
  sub.connect(subGain).connect(out);

  // --- growl ----------------------------------------------------------------
  const sawA = ctx.createOscillator();
  sawA.type = 'sawtooth';
  sawA.frequency.value = 62;
  sawA.detune.value = -9;
  const sawB = ctx.createOscillator();
  sawB.type = 'sawtooth';
  sawB.frequency.value = 62;
  sawB.detune.value = 11;

  // Hard lowpass: above about 900 Hz a sawtooth stops being a growl and starts
  // being a buzz sitting on top of the voice instead of underneath it.
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 820;
  body.Q.value = 0.9;
  sawA.connect(body);
  sawB.connect(body);

  // Soft clipping. The curve is a plain tanh: gentle through the middle so
  // quiet speech stays clean, compressing hard at the extremes so loud speech
  // roughens. Harmonics that appear WITH level are what the ear reads as
  // effort, which is most of what makes a voice sound large.
  const grit = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.6);
  }
  grit.curve = curve;
  grit.oversample = '2x';
  body.connect(grit);

  // THE FRY. A GainNode driven by an audio-rate oscillator is a multiplier, so
  // this is amplitude modulation: the growl is chopped 31 times a second, slow
  // enough that the ear resolves the individual pulses as texture rather than
  // fusing them into a pitch.
  const fry = ctx.createGain();
  fry.gain.value = 0.55;
  const fryLfo = ctx.createOscillator();
  fryLfo.type = 'triangle';
  fryLfo.frequency.value = 31;
  const fryDepth = ctx.createGain();
  fryDepth.gain.value = 0.45;
  fryLfo.connect(fryDepth).connect(fry.gain);
  grit.connect(fry);

  const growlGain = ctx.createGain();
  growlGain.gain.value = 0;
  fry.connect(growlGain).connect(out);

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
  sawA.start(now);
  sawB.start(now);
  fryLfo.start(now);
  noise.start(now);

  const stop = () => {
    for (const node of [sub, sawA, sawB, fryLfo]) {
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

  return { ctx, sub, subGain, growlGain, airGain, out, stop };
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

  const { ctx, sub, subGain, growlGain, airGain } = chain;
  const t = ctx.currentTime;

  /**
   * Three times louder than it was.
   *
   * At a sixth of the speech level this layer was technically present and
   * inaudible — the synthesiser's own timbre carried the whole voice, and that
   * timbre is the flat, even thing the character was meant to replace. It has
   * to be loud enough to be heard as part of the SAME source, which means loud
   * enough that removing it is obvious.
   *
   * The growl is squared against level rather than linear, so it appears on
   * stressed syllables and stays out of the quiet ones. A constant growl is a
   * fault tone; one that comes and goes with emphasis is a voice.
   */
  subGain.gain.setTargetAtTime(level * 0.42, t, 0.035);
  growlGain.gain.setTargetAtTime(level * level * 0.30, t, 0.028);
  // Air only on the loud parts — under a consonant it just sounds like a fault.
  airGain.gain.setTargetAtTime(Math.max(0, level - 0.45) * 0.05, t, 0.05);

  // A slow wander in the sub, so the layer is not a dead tone sitting under a
  // moving voice. Small enough that it reads as instability, not as pitch.
  sub.frequency.setTargetAtTime(44 + Math.sin(t * 0.7) * 1.3, t, 0.2);
}

/** Silence the layer without tearing it down; speech starts again often. */
export function restVoiceCharacter(): void {
  if (!chain) return;
  const t = chain.ctx.currentTime;
  chain.subGain.gain.setTargetAtTime(0, t, 0.08);
  chain.growlGain.gain.setTargetAtTime(0, t, 0.08);
  chain.airGain.gain.setTargetAtTime(0, t, 0.08);
}

/** Release the oscillators. Called when the page is going away. */
export function disposeVoiceCharacter(): void {
  chain?.stop();
  chain = null;
}
