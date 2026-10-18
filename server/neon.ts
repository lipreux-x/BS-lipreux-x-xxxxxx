// Neon branch config. Deploy to the linked branch (dev) with:
//   neon deploy --env .env --no-env-pull
// --no-env-pull keeps the hand-written .env untouched.
import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  functions: {
    api: {
      name: 'BaseSecrete API',
      source: 'src/index.ts',
      env: { JWT_SECRET: process.env.JWT_SECRET!, GROUP_CODE_PEPPER: process.env.GROUP_CODE_PEPPER! },
    },
  },
  triggers: {
    'purge-expired': {
      type: 'schedule',
      function: 'api',
      cron: '0 * * * *', // hourly: delete expired ephemeral messages
      functionPath: '/internal/purge',
    },
  },
});
