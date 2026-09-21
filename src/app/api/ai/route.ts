import { NextRequest, NextResponse } from 'next/server';
import { streamGemini } from '@/server/ai/gemini';
import { streamOllama } from '@/server/ai/ollama';
import { resolveProvider } from '@/server/ai/provider';
import type { AskBody } from '@/server/ai/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One endpoint, two brains.
 *
 * The client speaks one wire format — newline-delimited JSON of `{t}`, `{call}`
 * and `{error}` — and never learns which provider produced it. Normalising at
 * the server edge means adding a third backend is a file in `server/ai`, not a
 * change to the speech pipeline, the holographic text, or the tool dispatch.
 */
export async function POST(request: NextRequest) {
  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const resolved = await resolveProvider();

  if (resolved.provider === 'ollama') {
    return streamOllama(body, { host: resolved.host, model: resolved.model });
  }
  if (resolved.provider === 'gemini') {
    return streamGemini(body, { key: resolved.key, model: resolved.model });
  }
  return NextResponse.json({ error: resolved.reason }, { status: 503 });
}

/** Which brain is running, for the HUD and for a quick sanity check by curl. */
export async function GET() {
  const resolved = await resolveProvider();
  return NextResponse.json({
    provider: resolved.provider,
    model: resolved.model,
    reason: resolved.reason,
    // Never the key itself; only whether one is present.
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
}
