'use client';

import { create } from 'zustand';
import { MODULE_BY_ID, type ModuleId } from '@/core/constants/modules';
import type { FaceData } from '@/scene/CardFacePainter';
import sampleModules from '@/generated/sampleModules.json';

/** Set by the static export build; absent in the normal server build. */
export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC === '1';

export interface ModuleRecord {
  face: FaceData;
  /** Rich payload for the expanded panel. Shape varies per module. */
  detail: unknown;
  fetchedAt: number;
  provenance: 'live' | 'sample' | 'error';
  error?: string;
}

interface ModuleDataState {
  records: Partial<Record<ModuleId, ModuleRecord>>;
  inflight: Partial<Record<ModuleId, boolean>>;
  load: (id: ModuleId, force?: boolean) => Promise<void>;
  loadAll: () => Promise<void>;
  get: (id: ModuleId) => ModuleRecord | undefined;
}

const TTL = 90_000;

export const useModuleData = create<ModuleDataState>()((set, get) => ({
  records: {},
  inflight: {},

  get: (id) => get().records[id],

  load: async (id, force = false) => {
    const def = MODULE_BY_ID[id];
    const existing = get().records[id];
    if (!force && existing && Date.now() - existing.fetchedAt < TTL) return;
    if (get().inflight[id]) return;

    /**
     * STATIC MODE — a build with no server behind it.
     *
     * The hosted preview has no `/api/*`, and a ring of cards all reading
     * "unreachable" would show nothing of what NEXUS actually is. The frozen
     * payloads are produced by running the REAL adapters with no API keys at
     * build time, so the faces are shaped by the same code that serves them
     * in production rather than by a hand-written copy that would drift.
     */
    if (STATIC_MODE) {
      // JSON imports widen tuple types ([string, string][] becomes string[][]),
      // so the cast goes through unknown rather than pretending they overlap.
      const frozen = (sampleModules as unknown as Record<
        string,
        { face: FaceData; detail: unknown }
      >)[id];
      if (frozen) {
        /**
         * The System module is still LIVE here, even with no server.
         *
         * Its interesting half — cores, battery, link speed, GPU, storage
         * quota — is read from the browser, and the browser is present in a
         * static build. Serving it the frozen server-side payload instead
         * replaced six real readings with a Node process's heap size, which
         * is both duller and, on a page that has no Node process behind it,
         * untrue.
         */
        const face =
          id === 'system' ? await enrichSystem(frozen.face) : frozen.face;
        set((s) => ({
          records: {
            ...s.records,
            [id]: {
              face,
              detail: frozen.detail,
              fetchedAt: Date.now(),
              provenance: 'sample',
            },
          },
        }));
        return;
      }
    }

    if (!def.endpoint) {
      set((s) => ({
        records: {
          ...s.records,
          [id]: {
            face: { title: def.label, caption: def.caption, status: 'local module' },
            detail: null,
            fetchedAt: Date.now(),
            provenance: 'sample',
          },
        },
      }));
      return;
    }

    set((s) => ({ inflight: { ...s.inflight, [id]: true } }));
    try {
      const res = await fetch(def.endpoint, { cache: 'no-store' });
      const json = (await res.json()) as {
        face: FaceData;
        detail: unknown;
        provenance: 'live' | 'sample';
      };
      let face = json.face;
      let detail = json.detail;

      /**
       * The System module is enriched on the client, because the client is
       * where the answers are: a Node process cannot report the battery, the
       * link speed, the GPU or the origin's disk usage. The server still
       * supplies its own side of it, and both are merged rather than one
       * replacing the other.
       */
      if (id === 'system') {
        const { readClientTelemetry } = await import('./clientTelemetry');
        face = await enrichSystem(face);
        detail = { server: json.detail, client: await readClientTelemetry() };
      }

      set((s) => ({
        records: {
          ...s.records,
          [id]: {
            face,
            detail,
            fetchedAt: Date.now(),
            provenance: json.provenance,
          },
        },
        inflight: { ...s.inflight, [id]: false },
      }));
    } catch (err) {
      set((s) => ({
        records: {
          ...s.records,
          [id]: {
            face: {
              title: def.label,
              caption: def.caption,
              status: 'unreachable',
              warned: true,
              provenance: 'error',
            },
            detail: null,
            fetchedAt: Date.now(),
            provenance: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        },
        inflight: { ...s.inflight, [id]: false },
      }));
    }
  },

  loadAll: async () => {
    await Promise.all(Object.keys(MODULE_BY_ID).map((id) => get().load(id as ModuleId)));
  },
}));

/**
 * Merge the browser's own telemetry into the System face.
 *
 * Shared by the live path and the static one: a Node process cannot report the
 * battery, the link speed, the GPU or the origin's disk usage, and the browser
 * can do all four whether or not there is a server on the other end.
 */
async function enrichSystem(face: FaceData): Promise<FaceData> {
  const { readClientTelemetry, telemetryRows } = await import('./clientTelemetry');
  const telemetry = await readClientTelemetry();
  const lowBattery = Boolean(
    telemetry.battery && telemetry.battery.level < 0.15 && !telemetry.battery.charging,
  );
  return {
    ...face,
    rows: telemetryRows(telemetry, face.rows ?? []),
    metric: telemetry.cores ? String(telemetry.cores) : face.metric,
    metricLabel: telemetry.cores ? 'logical cores' : face.metricLabel,
    status: lowBattery ? 'battery low' : 'nominal',
    // The only thing in the System module that earns warning orange.
    warned: lowBattery,
  };
}
