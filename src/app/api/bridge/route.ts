import { NextRequest, NextResponse } from 'next/server';
import { dispatch, isVerb, VERBS, type BridgeRequest } from '@/server/bridge/verbs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * THE DESKTOP BRIDGE.
 *
 * This is a remote code execution surface. Treating it as anything less would
 * be dishonest: it exists specifically so that a web page can cause programs to
 * run on the machine serving it.
 *
 * Six gates, in order, before any verb is dispatched. Each one is independently
 * sufficient to stop a different attacker, which is the point — none of them is
 * load-bearing alone.
 */
export async function POST(request: NextRequest) {
  // GATE 1 — OFF UNLESS EXPLICITLY ENABLED.
  // Not "enabled unless disabled", and not a truthy check: exactly "1". Someone
  // who has not decided to turn this on does not have it on.
  if (process.env.NEXUS_BRIDGE_ENABLED !== '1') {
    return NextResponse.json(
      { ok: false, message: 'The desktop bridge is disabled. Set NEXUS_BRIDGE_ENABLED=1 to enable it.' },
      { status: 503 },
    );
  }

  // GATE 2 — macOS ONLY, and every other platform fails CLEANLY.
  // A 501 with a plain message, not a crash: the rest of NEXUS is unaffected
  // and goes on working exactly as it does with the bridge switched off.
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { ok: false, message: 'The desktop bridge is macOS only. Everything else in NEXUS is unaffected.' },
      { status: 501 },
    );
  }

  // GATE 3 — LOOPBACK ONLY.
  // Refuse any Host that is not localhost. Binding to 0.0.0.0 on a café network
  // otherwise hands this surface to everyone on the subnet.
  const host = request.headers.get('host') ?? '';
  if (!isLoopback(host)) {
    return NextResponse.json(
      { ok: false, message: 'The desktop bridge only accepts loopback requests.' },
      { status: 403 },
    );
  }

  // GATE 4 — SAME ORIGIN ONLY.
  // Loopback is NOT sufficient on its own: any page on the internet can POST to
  // http://localhost:3000 from the user's own browser. The Origin header is set
  // by the browser and cannot be forged by page script, so it is the check that
  // actually distinguishes "NEXUS asked" from "some tab asked".
  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ ok: false, message: 'Bad origin.' }, { status: 403 });
    }
    if (originHost !== host || !isLoopback(originHost)) {
      return NextResponse.json(
        { ok: false, message: 'Cross-origin requests to the desktop bridge are refused.' },
        { status: 403 },
      );
    }
  }
  // A request with NO Origin is not a browser page request (fetch from a page
  // always sets it), so it is allowed through for CLI use. Combined with gate 3
  // that means a local process, which already has more access than this bridge.

  // GATE 5 — THE VERB IS AN ENUM MEMBER.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }
  const verb = (body as { verb?: unknown }).verb;
  if (!isVerb(verb)) {
    return NextResponse.json(
      { ok: false, message: `Unknown verb. Known verbs: ${VERBS.join(', ')}` },
      { status: 400 },
    );
  }

  // GATE 6 — ONLY DECLARED FIELDS CROSS THE BOUNDARY.
  // The request is rebuilt field by field rather than spread, so nothing the
  // caller invented reaches a handler.
  const source = body as Record<string, unknown>;
  const safe: BridgeRequest = {
    verb,
    app: str(source.app),
    url: str(source.url),
    query: str(source.query),
    action: str(source.action),
    text: str(source.text),
    title: str(source.title),
    value: typeof source.value === 'number' ? source.value : undefined,
  };

  try {
    const result = await dispatch(safe);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : 'The command failed.' },
      { status: 500 },
    );
  }
}

/** Capability probe for the ⌘K palette. Same gates, nothing executed. */
export async function GET(request: NextRequest) {
  const enabled = process.env.NEXUS_BRIDGE_ENABLED === '1' && process.platform === 'darwin';
  if (!enabled) {
    return NextResponse.json({ enabled: false, apps: [], verbs: VERBS });
  }
  if (!isLoopback(request.headers.get('host') ?? '')) {
    return NextResponse.json({ enabled: false, apps: [], verbs: [] }, { status: 403 });
  }
  const { scanApps } = await import('@/server/bridge/apps');
  const apps = await scanApps();
  return NextResponse.json({ enabled: true, apps: apps.map((a) => a.name), verbs: VERBS });
}

function isLoopback(host: string): boolean {
  const name = host.split(':')[0].toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '[::1]';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 8000 ? value : undefined;
}
