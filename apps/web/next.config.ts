import type { NextConfig } from 'next';

/** Backend for /api rewrite (SP / local). Browser can use same-origin NEXT_PUBLIC_API_URL="". */
const apiProxyTarget =
  process.env.FITGO_API_PROXY_TARGET?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  transpilePackages: ['@fitgo/shared-types'],
  // Nest refresh-from-1c can run ~2–3 min per week of class sessions.
  experimental: {
    proxyTimeout: 300_000,
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
