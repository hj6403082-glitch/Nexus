'use client';

import { create } from 'zustand';
import type { ModuleId } from '@/core/constants/modules';

export type AIStatus =
  | 'offline'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'streaming'
  | 'speaking'
  | 'interrupted';

export interface Turn {
  id: string;
  role: 'user' | 'model';
  text: string;
  at: number;
  /** True while tokens are still arriving for this turn. */
  streaming?: boolean;
}

interface AIState {
  status: AIStatus;
  setStatus: (s: AIStatus) => void;

  awake: boolean;
  /** Rises to 1 on wake and falls back — drives the scene-wide wave. */
  wakeWave: number;
  wake: (on: boolean) => void;
  setWakeWave: (v: number) => void;

  /** Partial speech-recognition result, shown live. */
  interim: string;
  setInterim: (t: string) => void;

  history: Turn[];
  appendUser: (text: string) => string;
  beginModel: () => string;
  appendToken: (id: string, token: string) => void;
  endTurn: (id: string) => void;
  reset: () => void;

  /**
   * Context awareness: what the user is looking at right now. "Explain this"
   * means nothing without it.
   */
  focusModule: ModuleId | null;
  setFocusModule: (id: ModuleId | null) => void;

  /** 0..1 speech level, drives the jaw and the UI sound reactivity. */
  speechLevel: number;
  setSpeechLevel: (v: number) => void;

  error: string | null;
  setError: (e: string | null) => void;
}

let n = 0;
const nextId = () => `t${++n}`;

export const useAIStore = create<AIState>()((set, get) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),

  awake: false,
  wakeWave: 0,
  wake: (on) => set({ awake: on, wakeWave: on ? 1 : get().wakeWave }),
  setWakeWave: (wakeWave) => set({ wakeWave }),

  interim: '',
  setInterim: (interim) => set({ interim }),

  history: [],
  appendUser: (text) => {
    const id = nextId();
    set((s) => ({ history: [...s.history, { id, role: 'user', text, at: Date.now() }] }));
    return id;
  },
  beginModel: () => {
    const id = nextId();
    set((s) => ({
      history: [...s.history, { id, role: 'model', text: '', at: Date.now(), streaming: true }],
    }));
    return id;
  },
  appendToken: (id, token) =>
    set((s) => ({
      history: s.history.map((t) => (t.id === id ? { ...t, text: t.text + token } : t)),
    })),
  endTurn: (id) =>
    set((s) => ({
      history: s.history.map((t) => (t.id === id ? { ...t, streaming: false } : t)),
    })),
  reset: () => set({ history: [], interim: '', status: 'idle' }),

  focusModule: null,
  setFocusModule: (focusModule) => set({ focusModule }),

  speechLevel: 0,
  setSpeechLevel: (speechLevel) => set({ speechLevel }),

  error: null,
  setError: (error) => set({ error }),
}));
