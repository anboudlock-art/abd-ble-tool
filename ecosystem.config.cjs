// pm2 process manifest for the single-ECS deploy.
// See docs/deploy-aliyun.md for the full setup.
module.exports = {
  apps: [
    {
      name: 'abd-api',
      cwd: __dirname,
      script: 'apps/api/dist/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'abd-gw-server',
      cwd: __dirname,
      script: 'apps/gw-server/dist/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'abd-worker',
      cwd: __dirname,
      script: 'apps/worker/dist/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'abd-web',
      cwd: __dirname,
      // standalone bundle is self-contained; don't run via pnpm/next.
      script: 'apps/web/.next/standalone/apps/web/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '127.0.0.1',
      },
      max_memory_restart: '512M',
    },
  ],
};
