import { contextBlock, encodeLine, SYSTEM, TOOLS, type AskBody } from './prompt';

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

/**
 * OLLAMA — the model runs on the same machine as the server.
 *
 * Which makes it the better default for NEXUS than a hosted API: there is no
 * key to paste anywhere, no credential to leak, no per-token cost on an
 * assistant you talk to continuously, and it keeps working on a plane.
 *
 * Ollama streams newline-delimited JSON of the shape
 *   {"message":{"role":"assistant","content":"…"},"done":false}
 * and signals completion with `done: true`. Tool calls arrive as
 * `message.tool_calls[].function` with arguments ALREADY PARSED into an
 * object — unlike OpenAI-compatible APIs, which hand you a JSON string. That
 * difference is the single easiest thing to get wrong when porting a client.
 */
export async function streamOllama(
  body: AskBody,
  options: { host: string; model: string },
): Promise<Response> {
  const messages = [
    { role: 'system', content: SYSTEM + contextBlock(body) },
    ...body.history.slice(-24).map((turn) => ({
      // Ollama speaks user/assistant; the app speaks user/model.
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.text,
    })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${options.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
        stream: true,
        options: { temperature: 0.7, num_predict: 800 },
        tools: TOOLS.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: { type: 'object', properties: tool.properties, required: tool.required },
          },
        })),
      }),
    });
  } catch {
    return offline(
      `Cannot reach Ollama at ${options.host}. Is it running? Start it with "ollama serve".`,
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    // A missing model is the overwhelmingly common failure, and Ollama's own
    // message for it does not tell you the fix.
    if (/model .* not found|no such model/i.test(detail)) {
      return offline(
        `Ollama has no model called "${options.model}". Pull it with: ollama pull ${options.model}`,
      );
    }
    return offline(`Ollama returned ${upstream.status}. ${detail.slice(0, 200)}`);
  }

  return new Response(toNdjson(upstream.body), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-nexus-provider': 'ollama',
    },
  });
}

/** Ollama's NDJSON → the app's NDJSON. Exported so it can be tested directly. */
export function parseOllamaLine(line: string): { t?: string; call?: { name: string; args: Record<string, string> }; error?: string }[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: {
    message?: {
      content?: string;
      tool_calls?: { function?: { name?: string; arguments?: Record<string, string> | string } }[];
    };
    error?: string;
  };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return []; // A partial line; the caller's carry picks it up next round.
  }

  if (parsed.error) return [{ error: parsed.error }];

  const out: ReturnType<typeof parseOllamaLine> = [];
  const content = parsed.message?.content;
  if (content) out.push({ t: content });

  for (const call of parsed.message?.tool_calls ?? []) {
    const fn = call.function;
    if (!fn?.name) continue;
    // Ollama hands back a parsed object; some builds and proxies hand back a
    // JSON string. Accept both rather than trusting one.
    let args: Record<string, string> = {};
    if (typeof fn.arguments === 'string') {
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }
    } else if (fn.arguments) {
      args = fn.arguments;
    }
    out.push({ call: { name: fn.name, args } });
  }

  return out;
}

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
            for (const event of parseOllamaLine(line)) controller.enqueue(encodeLine(event));
          }
        }
        // The final line often arrives without a trailing newline.
        for (const event of parseOllamaLine(carry)) controller.enqueue(encodeLine(event));
      } catch (err) {
        controller.enqueue(
          encodeLine({ error: err instanceof Error ? err.message : 'ollama stream failed' }),
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

/** Which models this Ollama has, for the provider probe. */
export async function listOllamaModels(host: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const json = (await res.json()) as { models?: { name?: string }[] };
    return (json.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  } catch {
    return null;
  }
}
