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
  buckets: {
    // Encrypted images (src/lib/storage.ts). Private: phones go through presigned URLs.
    attachments: {},
  },
  triggers: {
    'purge-expired': {
      type: 'schedule',
      function: 'api',
      // Every 6 hours: delete expired ephemeral messages and self-destructed
      // groups. Expired rows are already invisible to every query, so the
      // purge only reclaims space; each run wakes the compute for ~5 min
      // (scale-to-zero timer), so hourly would burn ~16 CU-hours a month.
      cron: '0 */6 * * *',
      functionPath: '/internal/purge',
    },
  },
});
