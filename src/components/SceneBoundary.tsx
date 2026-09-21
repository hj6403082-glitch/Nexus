'use client';

import { Component, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/useSystemStore';
import { wasContextLost } from '@/scene/gpuState';

interface Props {
  children: ReactNode;
  onFail: (reason: string) => void;
}

/**
 * If the scene dies, the app must not.
 *
 * NEXUS is one large WebGL surface, and a WebGL surface has failure modes that
 * ordinary React does not: a shader that will not compile on some driver, a
 * buffer that will not allocate, a context the browser takes away. Any of
 * those throws inside the render loop, React unmounts the whole tree, and the
 * user is left on a white page with no way back — including no way to reach
 * the data, which is still perfectly available over HTTP.
 *
 * So the scene is wrapped. When it fails, the flat mode takes over with the
 * same live modules, and the reason is put in front of the user rather than
 * only in the console.
 */
export class SceneBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    /**
     * A lost context makes every WebGL call return null, so React almost
     * always throws a null-property error in the same frame the loss fires —
     * and that error's message ("Cannot read properties of null (reading
     * 'alpha')") is true, useless and alarming. When the context is the known
     * cause, say so instead.
     */
    const reason = wasContextLost()
      ? 'the GPU dropped this page’s graphics context'
      : error.message || 'the 3D scene failed to render';

    useSystemStore.getState().pushLog(`scene failed · ${reason.slice(0, 80)}`, 'warn');
    this.props.onFail(reason);
  }

  render() {
    // The fallback is rendered by the parent, which owns the flat mode; this
    // only has to stop the broken subtree from taking the page with it.
    return this.state.failed ? null : this.props.children;
  }
}
