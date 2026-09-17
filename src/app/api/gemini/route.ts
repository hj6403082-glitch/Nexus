import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'gemini-2.0-flash';

interface Turn {
  role: 'user' | 'model';
  text: string;
}

interface Body {
  history: Turn[];
  /** What the user is looking at right now. "Explain this" needs it. */
  focusModule?: string | null;
  /** The live payload of that module, so the model can actually read it. */
  focusData?: unknown;
}

const SYSTEM = `You are NEXUS, a spatial computing assistant rendered as a holographic presence.

Voice: precise, calm, economical. You are speaking aloud — the user hears you
before they read you — so write for the ear. Short sentences. No markdown, no
bullet lists, no emoji, no stage directions. Never describe your own interface.

You have a body and a room. The user may ask you to take human form; you have a
transform_form tool for that. You can open modules on the ring: instagram,
stocks, projects, sports, calendar, weather, ai, news, music, system.

When the user says "this" or "that", they mean the module currently in focus.
Its live data is given to you below when there is one. Quote real figures from
it; never invent a number. If you do not have the data, say so in one sentence.`;

export async function POST(request: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY is not set. Voice and chat are offline.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
  }

  const contextBlock = body.focusModule
    ? `\n\nCurrently in focus: ${body.focusModule}.\nIts live data:\n${JSON.stringify(body.focusData).slice(0, 4000)}`
    : '\n\nNothing is currently in focus.';

  const contents = body.history.slice(-24).map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM + contextBlock }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'transform_form',
                description:
                  'Change the assistant between its spatial ring form and its human form. Use for any phrasing the local matcher missed.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    to: { type: 'STRING', enum: ['human', 'spatial'] },
                  },
                  required: ['to'],
                },
              },
              {
                name: 'open_module',
                description: 'Bring a module into focus.',
                parameters: {
                  type: 'OBJECT',
                  properties: { module: { type: 'STRING' } },
                  required: ['module'],
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: `model unavailable (${upstream.status})`, detail: detail.slice(0, 400) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  /**
   * Re-emit as a plain newline-delimited JSON stream.
   *
   * The client needs tokens the moment they exist — speech has to begin before
   * the response is complete, or the pause before NEXUS starts talking is the
   * whole latency of the generation. So nothing is buffered here beyond the
   * partial SSE frame at the tail of each chunk.
   */
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += decoder.decode(value, { stream: true });
          const lines = carry.split('\n');
          carry = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (typeof part.text === 'string' && part.text) {
                  controller.enqueue(encoder.encode(JSON.stringify({ t: part.text }) + '\n'));
                }
                if (part.functionCall) {
                  controller.enqueue(
                    encoder.encode(JSON.stringify({ call: part.functionCall }) + '\n'),
                  );
                }
              }
            } catch {
              // A partial frame; the carry picks it up next round.
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ error: err instanceof Error ? err.message : 'stream failed' }) + '\n',
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
