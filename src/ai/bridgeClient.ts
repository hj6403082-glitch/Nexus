'use client';

import type { BridgeRequest, BridgeResponse } from '@/server/bridge/verbs';

let capabilities: { enabled: boolean; apps: string[] } | null = null;

export async function bridgeCapabilities(): Promise<{ enabled: boolean; apps: string[] }> {
  if (capabilities) return capabilities;
  // A static build has no server to shell out from.
  if (process.env.NEXT_PUBLIC_STATIC === '1') {
    capabilities = { enabled: false, apps: [] };
    return capabilities;
  }
  try {
    const res = await fetch('/api/bridge');
    const json = (await res.json()) as { enabled: boolean; apps: string[] };
    capabilities = { enabled: Boolean(json.enabled), apps: json.apps ?? [] };
  } catch {
    capabilities = { enabled: false, apps: [] };
  }
  return capabilities;
}

/**
 * Every failure explains what to do about it. A bridge call that returns
 * "failed" and nothing else sends the user to a search engine; one that names
 * the System Settings pane sends them to the fix.
 */
export async function callBridge(request: BridgeRequest): Promise<BridgeResponse> {
  try {
    const res = await fetch('/api/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const json = (await res.json()) as BridgeResponse;
    if (json.setting) {
      return { ...json, message: `${json.message} (System Settings → ${json.setting})` };
    }
    return json;
  } catch {
    return { ok: false, message: 'The desktop bridge is unreachable.' };
  }
}
