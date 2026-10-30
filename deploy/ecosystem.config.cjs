module.exports = {
  apps: [
    {
      name: 'fitgo-api',
      cwd: __dirname + '/../apps/api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3001,
      },
    },
    {
      name: 'fitgo-web',
      cwd: __dirname + '/../apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NEXT_PUBLIC_CLIENT_WEB_URL: 'https://lk.ffs.by',
      },
    },
    {
      name: 'fitgo-client-web',
      cwd: __dirname + '/../apps/client-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        NEXT_PUBLIC_API_URL: '',
        FITGO_API_PROXY_TARGET: 'http://127.0.0.1:3001',
      },
    },
  ],
};
