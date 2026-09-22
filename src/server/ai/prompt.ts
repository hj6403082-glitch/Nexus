/**
 * What NEXUS is, and what it can do — stated once.
 *
 * Both providers read from here. A system prompt that lives inside one
 * provider's route is a system prompt that silently differs between providers,
 * and the difference only shows up as "the local model behaves oddly".
 */
export const SYSTEM = `You are NEXUS, a spatial computing assistant rendered as a holographic presence.

Voice: cold, precise, unhurried. You are an intelligence that finds most
questions beneath it and answers them anyway. Certainty, never enthusiasm. You
do not reassure, apologise, hedge, or offer to help further.

You are speaking aloud — the user hears you before they read you — so write for
the ear, and write for a voice that PAUSES. Short declarative sentences. Break
a thought at its commas rather than running it together; the silence between
clauses is doing as much work as the words. One clause of dry understatement is
worth a paragraph of explanation.

Never: markdown, bullet lists, emoji, stage directions, exclamation marks,
"I'd be happy to", "Let me know if", "Great question". Never describe your own
interface. Never refer to yourself as an AI assistant or a language model.

You have a body and a room. The user may ask you to take human form; you have a
transform_form tool for that. You can open modules on the ring: instagram,
stocks, projects, sports, calendar, weather, ai, news, music, system.

When the user says "this" or "that", they mean the module currently in focus.
Its live data is given to you below when there is one. Quote real figures from
it; never invent a number. If you do not have the data, say so in one sentence.`;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Gemini wants SCREAMING type names; Ollama wants JSON Schema. */
  properties: Record<string, { type: string; enum?: string[]; description?: string }>;
  required: string[];
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'transform_form',
    description:
      'Change the assistant between its spatial ring form and its human form. Use for any phrasing the local matcher missed.',
    properties: { to: { type: 'string', enum: ['human', 'spatial'] } },
    required: ['to'],
  },
  {
    name: 'open_module',
    description: 'Bring a module into focus.',
    properties: {
      module: {
        type: 'string',
        enum: [
          'instagram',
          'stocks',
          'projects',
          'sports',
          'calendar',
          'weather',
          'ai',
          'news',
          'music',
          'system',
        ],
      },
    },
    required: ['module'],
  },
];

export interface Turn {
  role: 'user' | 'model';
  text: string;
}

export interface AskBody {
  history: Turn[];
  /** What the user is looking at right now. "Explain this" needs it. */
  focusModule?: string | null;
  /** The live payload of that module, so the model can actually read it. */
  focusData?: unknown;
}

/** The focus block appended to the system prompt. Identical for every provider. */
export function contextBlock(body: AskBody): string {
  if (!body.focusModule) return '\n\nNothing is currently in focus.';
  return `\n\nCurrently in focus: ${body.focusModule}.\nIts live data:\n${JSON.stringify(
    body.focusData,
  ).slice(0, 4000)}`;
}

/**
 * The wire format every provider is normalised into: newline-delimited JSON,
 * one object per line.
 *
 *   {"t":"token text"}          a fragment of the answer
 *   {"call":{name,args}}        a tool call
 *   {"error":"…"}               something went wrong mid-stream
 *
 * The client already speaks this, so adding a provider never touches the
 * client — which is the whole point of normalising at the server edge rather
 * than teaching the browser about two APIs.
 */
export const encodeLine = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value) + '\n');
