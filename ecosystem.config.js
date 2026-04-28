module.exports = {
  apps: [
    {
      name: 'abd-api',
      cwd: '/root/abd-ble-tool/apps/api',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://abd:abd_dev_password@localhost:5432/abd?schema=public',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'change-me-in-production',
        API_PORT: 3001,
        API_HOST: '0.0.0.0',
        CORS_ORIGIN: 'http://120.77.218.138:3000',
        VENDOR_BOOTSTRAP_TOKEN: 'bootstrap123'
      }
    },
    {
      name: 'abd-web',
      cwd: '/root/abd-ble-tool/apps/web',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
