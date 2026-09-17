'use client';

import { create } from 'zustand';
import { MODULE_BY_ID, type ModuleId } from '@/core/constants/modules';
import type { FaceData } from '@/scene/CardFacePainter';

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
      set((s) => ({
        records: {
          ...s.records,
          [id]: {
            face: json.face,
            detail: json.detail,
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
