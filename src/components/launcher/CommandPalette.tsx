'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MODULES } from '@/core/constants/modules';
import { NAMED_WORLDS } from '@/core/constants/worlds';
import { bridgeCapabilities, callBridge } from '@/ai/bridgeClient';
import { useSystemStore } from '@/stores/useSystemStore';
import { useLenis } from '@/hooks/useLenis';
import { rank, type Rankable } from './rank';
import { BEAT } from '@/core/constants/motion';

const SITES: Rankable[] = [
  { id: 'site:github', label: 'GitHub', source: 'site', detail: 'github.com' },
  { id: 'site:youtube', label: 'YouTube', source: 'site', detail: 'youtube.com' },
  { id: 'site:instagram', label: 'Instagram', source: 'site', detail: 'instagram.com' },
  { id: 'site:gmail', label: 'Gmail', source: 'site', detail: 'mail.google.com' },
  { id: 'site:linear', label: 'Linear', source: 'site', detail: 'linear.app' },
  { id: 'site:figma', label: 'Figma', source: 'site', detail: 'figma.com' },
  { id: 'site:tradingview', label: 'TradingView', source: 'site', detail: 'tradingview.com' },
];

const SITE_URLS: Record<string, string> = {
  'site:github': 'https://github.com',
  'site:youtube': 'https://youtube.com',
  'site:instagram': 'https://instagram.com',
  'site:gmail': 'https://mail.google.com',
  'site:linear': 'https://linear.app',
  'site:figma': 'https://figma.com',
  'site:tradingview': 'https://tradingview.com',
};

export interface PaletteProps {
  onCommand: (text: string) => void;
}

/**
 * ⌘K.
 *
 * Apps and websites in ONE list with source tags, because the user does not
 * think "is Figma an app or a tab on this machine" — they think "Figma". Two
 * lists would make them answer a question they should never have been asked.
 *
 * MOUNTED OUTSIDE THE HUD VISIBILITY GATE. Hiding the HUD is what you do to
 * look at the scene, and it is exactly then that you most want a way to act
 * without bringing the whole interface back.
 */
export function CommandPalette({ onCommand }: PaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [apps, setApps] = useState<string[]>([]);
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLenis(listRef, open);

  useEffect(() => {
    void bridgeCapabilities().then((c) => {
      setApps(c.apps);
      setBridgeEnabled(c.enabled);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setCursor(0);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<Rankable[]>(() => {
    const modules: Rankable[] = MODULES.map((m) => ({
      id: `module:${m.id}`,
      label: m.label,
      source: 'module',
      detail: m.caption,
    }));
    const installed: Rankable[] = apps.map((name) => ({
      id: `app:${name}`,
      label: name,
      source: 'app',
      detail: 'application',
    }));
    const commands: Rankable[] = [
      { id: 'cmd:human', label: 'Transform into a human shape', source: 'command' },
      { id: 'cmd:spatial', label: 'Return to spatial mode', source: 'command' },
      { id: 'cmd:lock', label: 'Lock the scene', source: 'command' },
      { id: 'cmd:drift', label: 'Enable ambient drift', source: 'command' },
      { id: 'cmd:capture', label: 'Capture the screen', source: 'command' },
      { id: 'cmd:clipboard', label: 'Read the clipboard', source: 'command' },
      { id: 'cmd:hide', label: 'Hide other applications', source: 'command' },
      ...NAMED_WORLDS.map((w) => ({
        id: `world:${w.id}`,
        label: w.label,
        source: 'command' as const,
        detail: 'environment',
      })),
    ];
    return [...modules, ...commands, ...installed, ...SITES];
  }, [apps]);

  const results = useMemo(() => rank(items, query), [items, query]);

  const activate = async (item: Rankable) => {
    setOpen(false);
    const [kind, value] = item.id.split(':');

    if (kind === 'world') return onCommand(`switch to the ${value.replace(/-/g, ' ')} world`);
    if (kind === 'module') return onCommand(`open ${value}`);
    if (kind === 'app') return onCommand(`open ${value}`);
    if (kind === 'site') {
      const result = await callBridge({ verb: 'open_url', url: SITE_URLS[item.id] });
      useSystemStore.getState().pushLog(result.message, result.ok ? 'ok' : 'warn');
      if (!result.ok) window.open(SITE_URLS[item.id], '_blank', 'noopener');
      return;
    }
    switch (item.id) {
      case 'cmd:human':
        return onCommand('transform into a human shape');
      case 'cmd:spatial':
        return onCommand('return to spatial mode');
      case 'cmd:lock':
        return onCommand('lock');
      case 'cmd:drift':
        return onCommand('drift');
      case 'cmd:capture': {
        const r = await callBridge({ verb: 'screen_capture' });
        useSystemStore.getState().pushLog(r.message, r.ok ? 'ok' : 'warn');
        return;
      }
      case 'cmd:clipboard': {
        const r = await callBridge({ verb: 'clipboard_read' });
        useSystemStore.getState().pushLog(r.message, r.ok ? 'ok' : 'warn');
        return;
      }
      case 'cmd:hide': {
        const r = await callBridge({ verb: 'hide_others' });
        useSystemStore.getState().pushLog(r.message, r.ok ? 'ok' : 'warn');
        return;
      }
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: BEAT * 0.5 }}
          onMouseDown={() => setOpen(false)}
        >
          <motion.div
            className="mt-[14vh] w-[min(620px,92vw)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b111c]/95 shadow-2xl"
            initial={{ y: -16, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -10, scale: 0.99, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const item = results[cursor];
                  if (item) void activate(item);
                  else if (query.trim()) {
                    setOpen(false);
                    onCommand(query.trim());
                  }
                }
              }}
              placeholder="Ask, open, or command…"
              className="w-full bg-transparent px-5 py-4 text-[15px] text-nexus-ink outline-none placeholder:text-nexus-dim/60"
            />
            <div
              ref={listRef}
              className="max-h-[52vh] overflow-y-auto border-t border-white/[0.06]"
            >
              {results.map((item, i) => (
                <button
                  key={item.id}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void activate(item)}
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13.5px] ${
                    i === cursor ? 'bg-white/[0.06] text-nexus-ink' : 'text-nexus-ink/75'
                  }`}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.detail && (
                    <span className="truncate font-mono text-[10.5px] text-nexus-dim/70">
                      {item.detail}
                    </span>
                  )}
                  <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-nexus-dim">
                    {item.source}
                  </span>
                </button>
              ))}
              {results.length === 0 && (
                <div className="px-5 py-6 text-[13px] text-nexus-dim">
                  Press Enter to ask NEXUS.
                </div>
              )}
            </div>
            {!bridgeEnabled && (
              <div className="border-t border-white/[0.06] px-5 py-2 font-mono text-[10px] text-nexus-dim/70">
                desktop bridge off · set NEXUS_BRIDGE_ENABLED=1 on macOS for apps and windows
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
