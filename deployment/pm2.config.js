module.exports = {
  apps: [
    {
      name: 'rdd',
      script: './dist/index.js',
      // Single-user system con Socket.io: fork mode con 1 instancia.
      // Cluster mode requeriría sticky sessions y no aporta valor aquí.
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // wait_ready: el app emite process.send('ready') cuando el server escucha
      wait_ready: true,
      listen_timeout: 10000,
      // Graceful shutdown: SIGTERM → el app drena conexiones (10s) antes del kill
      kill_timeout: 15000,
      error_file: '../logs/rdd-error.log',
      out_file: '../logs/rdd-out.log',
      log_file: '../logs/rdd-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      autorestart: true,
      max_memory_restart: '500M',
      merge_logs: true,
    },
  ],
};
