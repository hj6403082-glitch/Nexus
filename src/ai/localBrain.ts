/**
 * THE BRAIN THAT NEEDS NO SERVER.
 *
 * NEXUS has two real brains — a local Ollama model and Gemini — both behind
 * one server endpoint. Neither is reachable from the hosted preview, because
 * that build is a STATIC EXPORT: no Node process, no `/api/*`, no key. So the
 * first thing anyone who opened the link saw was a figure that would not
 * answer, over a HUD that said BRAIN OFFLINE, which reads as a broken
 * application rather than as an unconfigured one.
 *
 * This is the third brain: it runs in the page. It cannot reason, and it is
 * not pretending to — what it can do is answer from the data the ring is
 * already holding, which covers most of what anyone asks a dashboard. "How is
 * Nvidia today" is a lookup, not an inference; so is "what's my schedule",
 * "how's the weather", "what's on the news", "how is this machine doing". Those
 * are real answers from real numbers, and they are available with nothing
 * configured at all.
 *
 * WHY IT SPEAKS THE SAME WIRE FORMAT
 *
 * It returns the same newline-delimited JSON of `{t}` and `{call}` that the
 * server streams. That is not decoration: it means the speech pipeline, the
 * sentence-boundary flush, the holographic text assembly and the tool dispatch
 * all work on its output without knowing it exists. A brain that returned a
 * plain string would have needed its own path through all four, and the two
 * paths would have drifted.
 *
 * It also paces itself. Emitting the whole answer in one chunk would defeat
 * the thing the streaming was for — the text assembles word by word and the
 * voice starts on the first sentence rather than after the last.
 */
import { MODULES, MODULE_BY_ID, type ModuleId } from '@/core/constants/modules';
import { NAMED_WORLDS } from '@/core/constants/worlds';
import type { FaceData } from '@/scene/CardFacePainter';

export interface LocalAsk {
  text: string;
  focusModule: ModuleId | null;
}

/**
 * What the ring is holding, handed in rather than reached for.
 *
 * The brain read the zustand stores directly at first, which made it
 * impossible to state what it answers without standing up a browser: the
 * verification suite would have had to import a canvas painter and a JSON
 * bundle to ask whether "how is Nvidia today" finds the stocks card. Taking a
 * snapshot as an argument makes the whole of the answering logic a pure
 * function of its input, which is the only kind that can be checked cheaply.
 */
export interface RingSnapshot {
  faces: Partial<Record<ModuleId, { face: FaceData; provenance: 'live' | 'sample' | 'error' }>>;
}

type Emit =
  | { t: string }
  | { call: { name: string; args: Record<string, string> } };

/** Words per second. Fast enough not to drag, slow enough to read as arriving. */
const PACE = 14;

/**
 * Answer, as a stream.
 *
 * A ReadableStream rather than a string so the caller's reader loop is the
 * same loop it runs against the server. The caller cannot tell the difference,
 * which is the point.
 */
export function askLocally(ask: LocalAsk, ring: RingSnapshot): ReadableStream<Uint8Array> {
  const events = respond(ask, ring);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        if ('call' in event) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          continue;
        }
        // One word at a time, at a readable pace.
        for (const word of splitKeepingSpaces(event.t)) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ t: word })}\n`));
          await sleep(1000 / PACE);
        }
      }
      controller.close();
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split so the spaces survive.
 *
 * The caller concatenates tokens exactly as they arrive and also scans the
 * result for sentence boundaries. Splitting on whitespace and dropping it
 * would produce "Nvidiaisat176.42" — one long word, no boundary, never spoken.
 */
function splitKeepingSpaces(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

// ---------------------------------------------------------------------------

export function respond(ask: LocalAsk, ring: RingSnapshot): Emit[] {
  const text = ask.text.toLowerCase().trim().replace(/[.!?,]+$/g, '');

  const greeting = matchGreeting(text);
  if (greeting) return [{ t: greeting }];

  const help = matchHelp(text);
  if (help) return [{ t: help }];

  const identity = matchIdentity(text);
  if (identity) return [{ t: identity }];

  // A module named in the question answers about that module AND brings it
  // forward, because "how is Nvidia today" is a request to see the stocks card
  // as much as it is a question about a price.
  const target = matchModule(text) ?? ask.focusModule;
  if (target) {
    const record = ring.faces[target];
    const answer = describe(target, record?.face, record?.provenance);
    const emits: Emit[] = [{ t: answer }];
    if (matchModule(text)) {
      emits.unshift({ call: { name: 'open_module', args: { module: target } } });
    }
    return emits;
  }

  const world = matchWorldName(text);
  if (world) {
    return [{ t: `Taking you to the ${world.label}.` }];
  }

  return [{ t: fallback(text) }];
}

// --- intents ---------------------------------------------------------------

function matchGreeting(text: string): string | null {
  if (!/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(text)) return null;
  return "I'm here. Ask me about any of the modules, or tell me where to go.";
}

function matchIdentity(text: string): string | null {
  if (!/\b(who|what) are you\b|\byour name\b|\bwhat is nexus\b/.test(text)) return null;
  return (
    'I am NEXUS, a spatial interface. Ten modules orbit you, each carrying live data. ' +
    'I can open them, change the room around you, or take a human form and hand you a panel.'
  );
}

function matchHelp(text: string): string | null {
  if (!/\b(help|what can you do|commands|capabilities)\b/.test(text)) return null;
  return (
    'Ask about any module by name — stocks, weather, news, the system, your schedule. ' +
    'Say "take me to the fog chamber" to change the room, or "transform into a human shape". ' +
    'Everything is also in the command palette.'
  );
}

function matchModule(text: string): ModuleId | null {
  for (const module of MODULES) {
    if (text.includes(module.id)) return module.id;
    if (text.includes(module.label.toLowerCase())) return module.id;
  }
  /**
   * The words people actually use, which are rarely the module's own name.
   *
   * Every entry takes an optional trailing s. Without it "how are the markets"
   * missed: a word boundary after "market" does not exist when the next
   * character is a letter, so the plural — which is how anyone would actually
   * phrase it — fell through to the apology.
   */
  const aliases: [RegExp, ModuleId][] = [
    [/\b(stock|share|market|ticker|nvidia|nvda|apple|aapl|tesla|portfolio)s?\b/, 'stocks'],
    [/\b(weather|rain|temperature|forecast|hot|cold|snow)s?\b/, 'weather'],
    [/\b(news|headline|article|happening|going on)s?\b/, 'news'],
    [/\b(schedule|calendar|meeting|agenda|today|appointment)s?\b/, 'calendar'],
    [/\b(machine|laptop|cpu|gpu|battery|memory|ram|disk|storage|performance)s?\b/, 'system'],
    [/\b(reel|instagram|insta|follower|post)s?\b/, 'instagram'],
    [/\b(music|song|track|playing|spotify)s?\b/, 'music'],
    [/\b(sport|score|match|game|fixture)s?\b/, 'sports'],
    [/\b(project|repo|repository|build|work)s?\b/, 'projects'],
  ];
  for (const [pattern, id] of aliases) {
    if (pattern.test(text)) return id;
  }
  return null;
}

function matchWorldName(text: string): { label: string } | null {
  for (const world of NAMED_WORLDS) {
    if (text.includes(world.label.toLowerCase())) return world;
    if (world.aliases.some((a) => text.includes(a))) return world;
  }
  return null;
}

// --- answering from the card -----------------------------------------------

/**
 * Read the card out loud.
 *
 * The face is the summary a person would read anyway — a headline figure and a
 * handful of labelled rows — so the answer is that, in a sentence. It is not a
 * paraphrase of the data; it IS the data, which is why it cannot be wrong in
 * the way a small language model's recollection of a share price can be.
 */
function describe(
  id: ModuleId,
  face: FaceData | undefined,
  provenance: 'live' | 'sample' | 'error' | undefined,
): string {
  const label = MODULE_BY_ID[id]?.label ?? id;
  if (!face) return `${label} has not loaded yet. Give it a moment and ask again.`;

  const parts: string[] = [];
  if (face.metric) {
    parts.push(`${label}: ${face.metric}${face.metricLabel ? ` ${face.metricLabel}` : ''}.`);
  } else {
    parts.push(`${label}: ${face.caption}.`);
  }

  // Three rows, not all of them. A card can carry six, and six read aloud is a
  // list rather than an answer.
  const rows = (face.rows ?? []).slice(0, 3);
  if (rows.length) {
    parts.push(rows.map(([rowLabel, value]) => `${rowLabel} ${value}`).join(', ') + '.');
  }

  if (provenance === 'sample') {
    // Said plainly. A number presented as live when it is frozen is the one
    // thing a dashboard must never do.
    parts.push('That is sample data — this build has no server behind it.');
  } else if (provenance === 'error') {
    parts.push('That source is unreachable right now.');
  } else if (face.age) {
    parts.push(`Fetched ${face.age}.`);
  }

  return parts.join(' ');
}

function fallback(text: string): string {
  if (!text) return 'I did not catch that.';
  return (
    'I am running on-device right now, with no model behind me, so I can only ' +
    'answer from what the ring is holding — stocks, weather, news, your schedule, ' +
    'this machine. Connect a model and I can take that properly.'
  );
}
