// Bootstrap: creates an invite directly in the database, for the very first
// account (afterwards, members create invites through POST /invites).
// Usage: npx tsx scripts/create-invite.ts [days] [--prod]
//   default: dev branch (.env); --prod: main branch (.env.production)
const prod = process.argv.includes('--prod');
process.loadEnvFile(prod ? '.env.production' : '.env');

const { db, pool } = await import('../src/db/client');
const { invites } = await import('../src/db/schema');
const { generateInviteCode, normalizeInviteCode, sha256Hex } = await import('../src/lib/crypto');

const days = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 7);
const code = generateInviteCode();
const expiresAt = new Date(Date.now() + days * 86_400_000);
await db.insert(invites).values({ codeHash: sha256Hex(normalizeInviteCode(code)), expiresAt });
console.log(`Invite (${prod ? 'production' : 'dev'}): ${code}  (expires ${expiresAt.toISOString()})`);
await pool.end();

export {};
