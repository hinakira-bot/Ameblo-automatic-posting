module.exports = {
  apps: [
    {
      name: 'ameblo-tool',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: __dirname,
      exec_mode: 'fork',        // fork モードに変更（ポート競合回避）
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,        // 停止時に5秒待ってから強制kill
      listen_timeout: 10000,     // 起動時に10秒待つ
      max_restarts: 10,          // 最大リスタート回数
      restart_delay: 3000,       // リスタート間隔3秒
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
