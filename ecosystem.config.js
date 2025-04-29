// ecosystem.config.js

module.exports = {
  apps : [
    {
      name        : 'LocalBarcodeVerifier', // Name for the local TUI app in PM2
      script      : 'local-app.js',
      cwd         : '.', // Current working directory
      interpreter : 'node',
      // Ensure correct user/permissions for GPIO if needed.
      // You might need to configure PM2 user or run PM2 with sudo initially.
      env: {
        NODE_ENV: 'production' // Or 'development' as needed
      }
    }
    // Removed the NextApp entry
  ]
};
