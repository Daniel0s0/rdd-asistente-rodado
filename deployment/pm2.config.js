module.exports = {
  apps: [
    {
      name: 'rdd',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '../logs/rdd-error.log',
      out_file: '../logs/rdd-out.log',
      log_file: '../logs/rdd-combined.log',
      time: true,
      autorestart: true,
      max_memory_restart: '500M',
      merge_logs: true,
    },
  ],
};
