import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: false, // WebGL contexts and MediaPipe graphs are not double-mount safe.
  transpilePackages: ['three'],
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'framer-motion'],
  },
  async headers() {
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
