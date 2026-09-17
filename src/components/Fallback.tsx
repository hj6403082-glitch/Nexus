'use client';

import { MODULES } from '@/core/constants/modules';
import { ACCENTS } from '@/core/constants/palette';
import { useModuleData } from '@/stores/useModuleData';
import { useEffect } from 'react';

/**
 * GRACEFUL FALLBACK.
 *
 * No WebGL, or the user asked for reduced motion: the modules are still here,
 * still carry live data, and are still readable and navigable. A spatial
 * interface that shows a browser-upgrade notice when the GPU is unavailable
 * has failed at the only job that survives the loss of the GPU.
 */
export function Fallback({ reason }: { reason: string }) {
  const records = useModuleData((s) => s.records);
  useEffect(() => {
    void useModuleData.getState().loadAll();
  }, []);

  return (
    <main className="min-h-dvh bg-nexus-void px-6 py-10 text-nexus-ink">
      <header className="mx-auto mb-10 max-w-5xl">
        <h1 className="font-mono text-[13px] tracking-[0.4em]">NEXUS</h1>
        <p className="mt-2 max-w-prose text-[13px] text-nexus-dim">
          Running in flat mode — {reason}. Every module below carries the same live data the
          spatial interface does.
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((module) => {
          const record = records[module.id];
          const accent = ACCENTS[module.accent];
          return (
            <section
              key={module.id}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div className="mb-2 h-[2px] w-10 rounded" style={{ background: accent.css }} />
              <h2 className="text-[19px] font-medium">{module.label}</h2>
              <p className="text-[12px] text-nexus-dim">{module.caption}</p>
              {record?.face.metric && (
                <p
                  className="mt-4 font-mono text-[34px] font-light tabular-nums"
                  style={{ color: accent.css }}
                >
                  {record.face.metric}
                </p>
              )}
              {record?.face.rows && (
                <dl className="mt-3 space-y-1 font-mono text-[12px]">
                  {record.face.rows.slice(0, 4).map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-nexus-dim">{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-4 font-mono text-[10px] text-nexus-dim/70">
                {record ? `${record.provenance} · ${record.face.age ?? ''}` : 'loading…'}
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}

/** WebGL2 with a real context, not just the constructor existing. */
export function detectWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    // A context that reports zero max texture size is a software stub.
    const max = (gl as WebGLRenderingContext).getParameter(
      (gl as WebGLRenderingContext).MAX_TEXTURE_SIZE,
    );
    return typeof max === 'number' && max >= 2048;
  } catch {
    return false;
  }
}
