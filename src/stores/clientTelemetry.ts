'use client';

import { useSystemStore } from './useSystemStore';

export interface ClientTelemetry {
  cores: number | null;
  deviceMemoryGb: number | null;
  battery: { level: number; charging: boolean } | null;
  network: { type: string; downlinkMbps: number | null } | null;
  storage: { usedGb: number; quotaGb: number } | null;
  gpu: string;
  fps: number;
}

/**
 * CPU, GPU, BATTERY, NETWORK, MEMORY, STORAGE.
 *
 * The System module is the one module where the CLIENT knows more than the
 * server. A Node process can report its own heap; it cannot report the
 * battery, the link speed, the GPU or how much disk the origin is using. Those
 * live behind browser APIs, so the server payload is enriched here rather than
 * being the whole story.
 *
 * Every one of these APIs is optional and several are being deprecated or are
 * Chromium-only. Each is probed independently and a missing one becomes `null`
 * rather than failing the module — a System panel that refuses to render
 * because Firefox has no Battery API is worse than one that says "unavailable".
 */
export async function readClientTelemetry(): Promise<ClientTelemetry> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
    connection?: { effectiveType?: string; downlink?: number };
  };

  const [battery, storage] = await Promise.all([
    (async () => {
      try {
        if (!nav.getBattery) return null;
        const b = await nav.getBattery();
        return { level: b.level, charging: b.charging };
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (!estimate?.quota) return null;
        return {
          usedGb: (estimate.usage ?? 0) / 1e9,
          quotaGb: estimate.quota / 1e9,
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const connection = nav.connection;
  const { gpu, fps } = useSystemStore.getState();

  return {
    cores: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    battery,
    network: connection
      ? { type: connection.effectiveType ?? 'unknown', downlinkMbps: connection.downlink ?? null }
      : null,
    storage,
    gpu,
    fps,
  };
}

/** The rows the System card shows, ordered as the brief lists them. */
export function telemetryRows(t: ClientTelemetry, serverRows: [string, string][]): [string, string][] {
  const rows: [string, string][] = [];

  rows.push(['cpu', t.cores ? `${t.cores} cores` : 'unavailable']);
  rows.push(['gpu', t.gpu.length > 22 ? `${t.gpu.slice(0, 22)}…` : t.gpu]);
  rows.push([
    'battery',
    t.battery
      ? `${Math.round(t.battery.level * 100)}%${t.battery.charging ? ' ⚡' : ''}`
      : 'unavailable',
  ]);
  rows.push([
    'network',
    t.network
      ? `${t.network.type}${t.network.downlinkMbps ? ` · ${t.network.downlinkMbps} Mb/s` : ''}`
      : 'unavailable',
  ]);
  rows.push([
    'memory',
    t.deviceMemoryGb ? `${t.deviceMemoryGb} GB` : (serverRows.find((r) => r[0] === 'heap')?.[1] ?? '—'),
  ]);
  rows.push([
    'storage',
    t.storage ? `${t.storage.usedGb.toFixed(2)} / ${t.storage.quotaGb.toFixed(0)} GB` : 'unavailable',
  ]);

  return rows;
}
