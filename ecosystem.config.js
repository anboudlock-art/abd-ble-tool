module.exports = {
  apps: [
    {
      name: 'abd-api',
      cwd: '/root/abd-ble-tool',
      script: 'apps/api/dist/index.js',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://abd:abd_dev_password@localhost:5432/abd?schema=public',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'change…tion',
        API_PORT: 3001,
        API_HOST: '0.0.0.0',
        CORS_ORIGIN: 'http://120.77.218.138',
        VENDOR_BOOTSTRAP_TOKEN: '***'
      }
    },
    {
      name: 'abd-web',
      cwd: '/root/abd-ble-tool',
      script: 'apps/web/.next/standalone/apps/web/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '127.0.0.1'
      }
    }
  ]
};
