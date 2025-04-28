// ecosystem.config.js

module.exports = {
  apps : [
    {
      name      : 'NextApp', // Name for the Next.js app in PM2
      script    : 'npm',
      args      : 'start',
      cwd       : '.', // Current working directory
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name      : 'GpioService', // Name for the background GPIO service in PM2
      script    : 'src/server/gpio-mqtt-service.js',
      cwd       : '.', // Current working directory
      // You might need to run this service with higher privileges for GPIO access
      // Consider using 'sudo -E node src/server/gpio-mqtt-service.js' if needed
      // or configuring user permissions for GPIO access.
      interpreter : 'node',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
