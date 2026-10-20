// `expo start` for the development build (see app.config.js): the QR code and
// deep links then open « BaseSecrète Dev », not the shareable app.
// Sets APP_VARIANT in a way that also works in npm scripts on Windows.
const { spawnSync } = require('node:child_process');

const { status } = spawnSync(['expo', 'start', ...process.argv.slice(2)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, APP_VARIANT: 'development' },
});
process.exit(status ?? 1);
