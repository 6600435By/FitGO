import type { NextConfig } from 'next';

/** Backend for /api rewrite (SP / local). Browser can use same-origin NEXT_PUBLIC_API_URL="". */
const apiProxyTarget =
  process.env.FITGO_API_PROXY_TARGET?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  transpilePackages: ['@fitgo/shared-types'],
  // Nest may wait on 1C up to ~120s; keep rewrite proxy above that.
  experimental: {
    proxyTimeout: 150_000,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
