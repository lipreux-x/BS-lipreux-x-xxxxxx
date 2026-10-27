// drizzle.config.ts against the production branch (Neon `main`):
//   npx drizzle-kit migrate --config drizzle.prod.config.ts
// The URL is read straight from .env.production: drizzle-kit loads `.env`
// (dev) on its own first, and process.loadEnvFile never overrides a variable
// already set, so a config relying on process.env silently migrates dev.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'drizzle-kit';

const prod = parseEnv(readFileSync(new URL('./.env.production', import.meta.url), 'utf8'));

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: prod.DATABASE_URL! },
});
