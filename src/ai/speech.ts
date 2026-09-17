import { useAIStore } from '@/stores/useAIStore';
import { audio } from '@/audio/AudioEngine';
import { clamp01 } from '@/core/math/util';

/** Cross-browser SpeechRecognition, which is still vendor-prefixed. */
type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

function getRecognition(): SR | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export interface ListenerOptions {
  onFinal: (text: string) => void;
  /** Called when the user starts speaking while NEXUS is speaking. */
  onBargeIn: () => void;
}

export class Listener {
  private recognition: SR | null = null;
  private wantRunning = false;

  constructor(private options: ListenerOptions) {}

  get supported(): boolean {
    return getRecognition() !== null;
  }

  start(): void {
    if (this.wantRunning) return;
    const r = getRecognition();
    if (!r) {
      useAIStore.getState().setError('speech recognition unavailable in this browser');
      return;
    }
    this.recognition = r;
    this.wantRunning = true;

    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          const text = transcript.trim();
          if (text) this.options.onFinal(text);
          interim = '';
        } else {
          interim += transcript;
        }
      }
      useAIStore.getState().setInterim(interim);

      /**
       * INTERRUPTION. If the user speaks while NEXUS is speaking, NEXUS stops
       * immediately — on the INTERIM result, not on the final one. Waiting for
       * a final result means waiting for the user to stop talking, which is
       * exactly the opposite of what interruption means.
       */
      if (interim.trim().length > 1 && useAIStore.getState().status === 'speaking') {
        this.options.onBargeIn();
      }
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      useAIStore.getState().setError(`microphone: ${e.error}`);
    };

    // Chrome ends continuous recognition on its own every so often.
    r.onend = () => {
      if (this.wantRunning) {
        try {
          r.start();
        } catch {
          /* already starting */
        }
      }
    };

    try {
      r.start();
      useAIStore.getState().setStatus('listening');
    } catch {
      /* already started */
    }
  }

  stop(): void {
    this.wantRunning = false;
    this.recognition?.stop();
    useAIStore.getState().setInterim('');
  }
}

/**
 * TEXT TO SPEECH, with a level the rest of the app can follow.
 *
 * The local synthesiser plays OUTSIDE the page's audio graph: the page cannot
 * hear it, an AnalyserNode sees silence, and the jaw would never move. So the
 * level is INFERRED — `speechSynthesis` reports word boundaries as it speaks,
 * and each word is turned into a pulse that opens and closes once per syllable.
 *
 * The inferred level is scaled into the same range an analyser produces for a
 * real audio stream, so everything downstream (the jaw, the UI reactivity, the
 * ducking) reads the two identically and none of it needs to know which voice
 * is speaking.
 */
export class Speaker {
  private utterance: SpeechSynthesisUtterance | null = null;
  private raf = 0;
  private pulses: { at: number; duration: number; syllables: number }[] = [];
  private startedAt = 0;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  speak(text: string, onDone?: () => void): void {
    if (!this.supported || !text.trim()) {
      onDone?.();
      return;
    }
    this.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 0.94;
    u.volume = 1;

    const voice = pickVoice();
    if (voice) u.voice = voice;

    this.pulses = [];
    this.startedAt = performance.now();

    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const word = text.slice(e.charIndex, e.charIndex + (e.charLength || 6));
      this.pulses.push({
        at: performance.now(),
        duration: Math.max(90, word.length * 62),
        syllables: countSyllables(word),
      });
    };

    u.onstart = () => {
      useAIStore.getState().setStatus('speaking');
      this.track();
    };

    const finish = () => {
      cancelAnimationFrame(this.raf);
      useAIStore.getState().setSpeechLevel(0);
      audio.duck(0);
      if (useAIStore.getState().status === 'speaking') {
        useAIStore.getState().setStatus('idle');
      }
      onDone?.();
    };
    u.onend = finish;
    u.onerror = finish;

    this.utterance = u;
    window.speechSynthesis.speak(u);
  }

  /** Stop mid-word. This is what makes interruption feel like interruption. */
  cancel(): void {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    cancelAnimationFrame(this.raf);
    this.pulses = [];
    useAIStore.getState().setSpeechLevel(0);
    audio.duck(0);
    this.utterance = null;
  }

  private track = (): void => {
    this.raf = requestAnimationFrame(this.track);
    const now = performance.now();

    let level = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const age = now - p.at;
      if (age > p.duration) {
        if (i < this.pulses.length - 4) this.pulses.splice(0, i);
        continue;
      }
      // One open-and-close per syllable, across the word's span.
      const phase = (age / p.duration) * p.syllables * Math.PI;
      level = Math.max(level, Math.abs(Math.sin(phase)));
    }

    // No boundary events at all (some voices report none): fall back to a
    // generic cadence so the mouth still moves rather than hanging open or shut.
    if (this.pulses.length === 0 && window.speechSynthesis.speaking) {
      const t = (now - this.startedAt) / 1000;
      level = Math.abs(Math.sin(t * 9.4)) * 0.62;
    }

    // Land it in the same range an analyser produces for the studio voice.
    const scaled = clamp01(level * 0.78);
    useAIStore.getState().setSpeechLevel(scaled);
    audio.duck(scaled);
  };
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred = [
    'Google UK English Female',
    'Samantha',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Karen',
  ];
  for (const name of preferred) {
    const found = voices.find((v) => v.name === name);
    if (found) return found;
  }
  return voices.find((v) => v.lang.startsWith('en')) ?? voices[0];
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.endsWith('e') && n > 1) n--;
  return Math.max(1, Math.min(5, n));
}

export const speaker = new Speaker();
