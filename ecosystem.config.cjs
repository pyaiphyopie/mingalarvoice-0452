const ports = require("./__ports.cjs");

module.exports = {
  apps: [
    {
      name: "web-app",
      cwd: __dirname,
      script: "packages/web/src/__server.ts",
      interpreter: "bun",
      interpreter_args: ["--env-file=.env"],
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 1000,
      env: {
        PORT: ports.website,
      },
    },
    {
      name: 'generation-worker',
      cwd: __dirname,
      script: '/usr/bin/bun',
      args: ['--env-file=.env', 'worker.ts'],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 2000,
      kill_timeout: 240000,
    },
  ],
};
