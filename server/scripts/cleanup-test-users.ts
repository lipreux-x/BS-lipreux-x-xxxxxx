// Removes accounts created by the mobile end-to-end test (usernames `e2e_*`),
// with their groups, memberships, keys, messages and invites.
// Usage: npx tsx scripts/cleanup-test-users.ts
process.loadEnvFile('.env');

const { db, pool } = await import('../src/db/client');
const { groups, invites, profiles } = await import('../src/db/schema');
const { inArray, like, or } = await import('drizzle-orm');

const ids = (await db.select({ id: profiles.id }).from(profiles).where(like(profiles.username, 'e2e\\_%'))).map((p) => p.id);
if (ids.length) {
  await db.delete(groups).where(inArray(groups.createdBy, ids));
  await db.delete(invites).where(or(inArray(invites.usedBy, ids), inArray(invites.createdBy, ids)));
  await db.delete(profiles).where(inArray(profiles.id, ids));
}
console.log(`Removed ${ids.length} test account(s).`);
await pool.end();

export {};
