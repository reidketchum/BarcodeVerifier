// ecosystem.config.js

module.exports = {
  apps : [
    {
      name        : 'LocalBarcodeVerifier', // Name for the local TUI app in PM2
      script      : '/home/pi/BarcodeVerifier/local-app.js', // Use absolute path
      // cwd         : '.', // cwd might not be needed with absolute path, but can keep
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
