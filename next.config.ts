import type { NextConfig } from 'next';

/**
 * The hosted preview is a STATIC EXPORT: no server, no API routes, no desktop
 * bridge, no AI. Everything that makes the room — the ring, the cards and
 * their live-shaped data, the presentation clock, the world grades, the
 * gestures and the human form — is client-side, so it all survives the export.
 *
 * Enabled by NEXUS_STATIC=1 so the normal build is untouched.
 */
const STATIC = process.env.NEXUS_STATIC === '1';

const config: NextConfig = {
  ...(STATIC
    ? {
        output: 'export' as const,
        distDir: '.next-static',
        // The preview is served from a sub-path, not from a domain root, so
        // every asset reference has to be relative. Without this the export
        // asks for /_next/... and finds nothing.
        assetPrefix: './',
      }
    : {}),
  env: { NEXT_PUBLIC_STATIC: STATIC ? '1' : '0' },
  reactStrictMode: false, // WebGL contexts and MediaPipe graphs are not double-mount safe.
  transpilePackages: ['three'],
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'framer-motion'],
  },
  async headers() {
    if (STATIC) return [];
    return [
      {
        // MediaPipe's WASM backend benefits from cross-origin isolation for SIMD threads.
        source: '/(.*)',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }],
      },
    ];
  },
};

export default config;
