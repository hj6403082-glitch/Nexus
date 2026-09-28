/**
 * THE VOICE PROFILE.
 *
 * Pure functions: which voice, how it is set, and where the line breaks. No
 * store, no audio graph, no browser objects beyond the ones passed in — so the
 * verification suite can exercise the cadence and the voice ranking directly
 * instead of taking them on trust.
 */

export interface Clause {
  text: string;
  /** Silence to hold after this clause, in milliseconds. */
  pauseMs: number;
}

/**
 * CADENCE.
 *
 * The timbre of a browser voice is not adjustable — `speechSynthesis` renders
 * outside the page's audio graph and cannot be filtered (see
 * `VoiceCharacter.ts`). What IS adjustable is when it stops.
 *
 * A cold intelligence does not speak in paragraphs. It states a thing, and
 * then it waits, and the waiting is most of the effect. So the line is broken
 * at its punctuation and each fragment is spoken as its own utterance with a
 * measured gap after it — longer at a full stop than at a comma, longer still
 * before a clause that begins with a conjunction, because that is where a
 * speaker who is choosing their words would pause.
 *
 * Queued utterances alone do not do this: a browser runs them together with no
 * seam, so the gap has to be a real timer between them.
 */
export function splitClauses(text: string): Clause[] {
  const pieces = text.match(/[^.!?;:,—]+[.!?;:,—]*/g) ?? [text];
  const clauses: Clause[] = [];

  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;

    const last = piece.slice(-1);
    // Longer than they were. The pauses are most of the character: a large,
    // unhurried thing does not run its sentences together, and the silence
    // after a statement is what makes it land as a statement.
    let pauseMs =
      last === '.' || last === '!' || last === '?'
        ? 620
        : last === ';' || last === ':' || last === '—'
          ? 460
          : last === ','
            ? 290
            : 190;

    // A fragment that opens with a conjunction is a decision being announced.
    // Hold a moment longer before it.
    if (/^(and|but|or|so|because|although|yet)\b/i.test(piece)) pauseMs += 190;

    clauses.push({ text: piece, pauseMs });
  }

  if (clauses.length) clauses[clauses.length - 1].pauseMs = 0;
  return clauses;
}

/**
 * The voice profile.
 *
 * Low and slow. `pitch` bottoms out at 0 and most engines are unusable there,
 * so 0.42 is about as far down as a voice stays intelligible; 0.88 rate gives
 * the deliberateness without sounding like a tape running out.
 *
 * This is a synthetic-menace CHARACTER — large, cold, unhurried — not an
 * impersonation of any particular performer, and nothing here attempts to
 * reproduce a real person's voice.
 */
export function applyVoiceProfile(u: SpeechSynthesisUtterance): void {
  // As low and as slow as stays intelligible. Most engines turn to mud below
  // about 0.2 of pitch and to a tape-stop below about 0.8 of rate; this sits
  // just inside both. There is nowhere further to go WITHIN the synthesiser —
  // everything else the voice has comes from the layer underneath it.
  u.rate = 0.82;
  u.pitch = 0.22;
  u.volume = 1;
  const voice = pickVoice();
  if (voice) u.voice = voice;
}

/**
 * The deepest, flattest voice the machine actually has.
 *
 * Ranked rather than chosen, because the installed set differs on every
 * platform and a single hard-coded name resolves to nothing on most of them.
 * The old list led with "Google UK English Female" and a bright, friendly
 * assistant voice is the opposite of what is wanted here.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[] = typeof window === 'undefined'
    ? []
    : window.speechSynthesis.getVoices(),
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  // In descending order of how well each carries the character.
  // Ordered by depth of the actual voice, not by how natural it sounds. A
  // smooth modern neural voice with a light timbre is further from the target
  // than an older, heavier one.
  const ranked = [
    'Microsoft Guy Online (Natural) - English (United States)',
    'Google UK English Male',
    'Daniel',
    'Microsoft David - English (United States)',
    'Microsoft Mark - English (United States)',
    'Alex',
    'Oliver',
    'Arthur',
    'Rishi',
    'Reed',
  ];
  for (const name of ranked) {
    const found = voices.find((v) => v.name === name);
    if (found) return found;
  }

  // Nothing on the list is installed: take any English voice that names itself
  // male, then any English voice at all.
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return english.find((v) => /male|man|guy/i.test(v.name)) ?? english[0] ?? voices[0];
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.endsWith('e') && n > 1) n--;
  return Math.max(1, Math.min(5, n));
}
