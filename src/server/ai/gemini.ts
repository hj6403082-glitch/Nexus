import { contextBlock, encodeLine, SYSTEM, TOOLS, type AskBody } from './prompt';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Say what is wrong with the key BEFORE spending a round trip on it.
 *
 * Gemini's REST endpoint authenticates with `?key=`, which accepts exactly one
 * kind of credential: an AI Studio key, `AIzaSy…`. Every other Google
 * credential is a different mechanism — OAuth access tokens (`ya29.`, `AQ.`)
 * are bearer tokens for different APIs, and a service account JSON is for
 * Vertex AI on a different host.
 *
 * Handed one of those, Google answers with a bare 400 naming none of this, and
 * you are left staring at "model unavailable (400)" holding a credential you
 * know is valid — because it IS valid, just not for this.
 */
export function describeKeyProblem(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.startsWith('ya29.') || trimmed.startsWith('AQ.')) {
    return 'That is a Google OAuth access token, not a Gemini API key. This endpoint needs an AI Studio key (starts with "AIzaSy") from https://aistudio.google.com/apikey — or set NEXUS_AI_PROVIDER=ollama and run a model locally with no key at all.';
  }
  if (trimmed.startsWith('{') || trimmed.includes('service_account')) {
    return 'That is a service account JSON, which is for Vertex AI on a different host. This endpoint needs an AI Studio key (starts with "AIzaSy"), or set NEXUS_AI_PROVIDER=ollama.';
  }
  if (trimmed.startsWith('sk-')) {
    return 'That is an OpenAI key. NEXUS talks to Gemini or to Ollama; get an AI Studio key from https://aistudio.google.com/apikey, or set NEXUS_AI_PROVIDER=ollama.';
  }
  if (!trimmed.startsWith('AIza')) {
    return 'GEMINI_API_KEY does not look like an AI Studio key — those start with "AIzaSy". Get one at https://aistudio.google.com/apikey, or set NEXUS_AI_PROVIDER=ollama to run locally with no key.';
  }
  return null;
}

export async function streamGemini(
  body: AskBody,
  options: { key: string; model: string },
): Promise<Response> {
  const problem = describeKeyProblem(options.key);
  if (problem) return offline(problem);

  const contents = body.history.slice(-24).map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?alt=sse&key=${options.key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM + contextBlock(body) }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          tools: [
            {
              functionDeclarations: TOOLS.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: {
                  type: 'OBJECT',
                  // Gemini wants SCREAMING type names in its schema dialect.
                  properties: Object.fromEntries(
                    Object.entries(tool.properties).map(([key, spec]) => [
                      key,
                      { type: spec.type.toUpperCase(), ...(spec.enum ? { enum: spec.enum } : {}) },
                    ]),
                  ),
                  required: tool.required,
                },
              })),
            },
          ],
        }),
      },
    );
  } catch {
    return offline('Cannot reach the Gemini API.');
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return offline(`Gemini returned ${upstream.status}. ${detail.slice(0, 300)}`);
  }

  return new Response(toNdjson(upstream.body), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-nexus-provider': 'gemini',
    },
  });
}

/** One SSE `data:` line → the app's NDJSON events. Exported for testing. */
export function parseGeminiLine(line: string): { t?: string; call?: { name: string; args: Record<string, string> } }[] {
  if (!line.startsWith('data:')) return [];
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return [];

  try {
    const parsed = JSON.parse(payload);
    const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
    const out: ReturnType<typeof parseGeminiLine> = [];
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text) out.push({ t: part.text });
      if (part.functionCall) {
        out.push({ call: { name: part.functionCall.name, args: part.functionCall.args ?? {} } });
      }
    }
    return out;
  } catch {
    return []; // A partial frame; the carry picks it up next round.
  }
}

/**
 * Re-emit as NDJSON. Nothing is buffered beyond the partial SSE frame at the
 * tail of each chunk: the client has to be able to start SPEAKING before the
 * response is complete, or the pause before NEXUS answers is the whole
 * generation latency.
 */
function toNdjson(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let carry = '';

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += decoder.decode(value, { stream: true });
          const lines = carry.split('\n');
          carry = lines.pop() ?? '';
          for (const line of lines) {
            for (const event of parseGeminiLine(line)) controller.enqueue(encodeLine(event));
          }
        }
      } catch (err) {
        controller.enqueue(
          encodeLine({ error: err instanceof Error ? err.message : 'gemini stream failed' }),
        );
      } finally {
        controller.close();
      }
    },
  });
}

function offline(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}
