// Removes accounts created by the mobile end-to-end test (usernames `e2e_*`),
// with their groups, memberships, keys, messages, images and invites.
// Usage: npx tsx scripts/cleanup-test-users.ts
// Bucket credentials: neon env pull --file .env.local -s object-storage (git-ignored).
process.loadEnvFile('.env');
try {
  process.loadEnvFile('.env.local');
} catch {
  // no bucket credentials: stored images are left for the bucket owner
}

const { db, pool } = await import('../src/db/client');
const { attachments, groupMembers, groups, invites, profiles } = await import('../src/db/schema');
const { deleteObjects, objectKey } = await import('../src/lib/storage');
const { and, eq, inArray, like, notExists, notInArray, or, sql } = await import('drizzle-orm');

const ids = (await db.select({ id: profiles.id }).from(profiles).where(like(profiles.username, 'e2e\\_%'))).map((p) => p.id);
if (ids.length) {
  const files = await db
    .select({ id: attachments.id, groupId: attachments.groupId })
    .from(attachments)
    .where(inArray(attachments.uploaderId, ids));
  await deleteObjects(files.map((f) => objectKey(f.groupId, f.id)));
  console.log(`Removed ${files.length} stored image(s).`);
  // Only groups with nothing but test accounts in them: a real user who joined
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
console.log(`Removed ${ids.length} test account(s).`);
await pool.end();

export {};
