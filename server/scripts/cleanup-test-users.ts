// Removes accounts created by the mobile end-to-end test (usernames `e2e_*`),
// or the accounts named on the command line, with their groups, memberships,
// keys, messages, images and invites.
// Usage: npx tsx scripts/cleanup-test-users.ts [--prod] [username ...]
//   default: dev branch (.env), usernames e2e_*; --prod: main branch (.env.production)
// Bucket credentials (dev only): neon env pull --file .env.local -s object-storage (git-ignored).
const prod = process.argv.includes('--prod');
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
process.loadEnvFile(prod ? '.env.production' : '.env');
if (!prod) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no bucket credentials: stored images are left for the bucket owner
  }
}

const { db, pool } = await import('../src/db/client');
const { attachments, groupMembers, groups, invites, profiles } = await import('../src/db/schema');
const { deleteObjects, objectKey } = await import('../src/lib/storage');
const { and, eq, inArray, like, notExists, notInArray, or, sql } = await import('drizzle-orm');

const found = await db
  .select({ id: profiles.id, username: profiles.username })
  .from(profiles)
  .where(names.length ? inArray(profiles.username, names) : like(profiles.username, 'e2e\_%'));
const ids = found.map((p) => p.id);
for (const n of names) if (!found.some((p) => p.username === n)) console.log(`No account named ${n}.`);
if (ids.length) {
  const files = await db
    .select({ id: attachments.id, groupId: attachments.groupId })
    .from(attachments)
    .where(inArray(attachments.uploaderId, ids));
  try {
    await deleteObjects(files.map((f) => objectKey(f.groupId, f.id)));
    console.log(`Removed ${files.length} stored file(s).`);
  } catch {
    console.log(`${files.length} stored file(s) left in the bucket (no credentials here).`);
  }
  // Only groups with nothing but these accounts in them: a real user who joined
  // a test group, or registered a name starting with e2e_, keeps theirs.
  await db.delete(groups).where(
    and(
      inArray(groups.createdBy, ids),
      notExists(
        db
          .select({ one: sql`1` })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groups.id), notInArray(groupMembers.userId, ids))),
      ),
    ),
  );
  await db.delete(invites).where(or(inArray(invites.usedBy, ids), inArray(invites.createdBy, ids)));
  await db.delete(profiles).where(inArray(profiles.id, ids));
}
console.log(`Removed ${ids.length} account(s): ${found.map((p) => p.username).join(', ') || '-'}.`);
await pool.end();

export {};
