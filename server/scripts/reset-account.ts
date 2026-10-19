// Frees a username whose phone lost its keys, for an account created before
// key backups (nothing can bring its identity back). Deletes the profile and
// the groups where it was the only member (unreadable without its keys, and
// their codes would stay taken), then prints an invite to sign up again.
// Usage: npx tsx scripts/reset-account.ts <username> --yes
// Refuses accounts with a password backup (they sign in again with it) and
// accounts that are the only admin of a group others are still in.
// Bucket credentials: neon env pull --file .env.local -s object-storage (git-ignored).
process.loadEnvFile('.env');
process.loadEnvFile('.env.local');

const { db, pool } = await import('../src/db/client');
const { attachments, groupMembers, groups, invites, joinAttempts, profiles } = await import('../src/db/schema');
const { generateInviteCode, normalizeInviteCode, sha256Hex } = await import('../src/lib/crypto');
const { deleteObjects, objectKey } = await import('../src/lib/storage');
const { eq, inArray, sql } = await import('drizzle-orm');

const username = process.argv[2];
if (!username || !process.argv.includes('--yes')) throw new Error('usage: reset-account.ts <username> --yes');
console.log(`Database: ${new URL(process.env.DATABASE_URL!).host}`);
const [p] = await db.select().from(profiles).where(eq(profiles.username, username));
if (!p) throw new Error(`no account named ${username}`);
// Anyone can claim "I lost my phone": an account with a backup comes back with its password, never through here.
if (p.backupAuth) throw new Error(`${username} has a password backup: they sign in again with it`);
const soleAdmin = await db
  .select({ id: groupMembers.groupId })
  .from(groupMembers)
  .where(
    sql`${groupMembers.userId} = ${p.id} and ${groupMembers.role} = 'admin'
        and not exists (select 1 from ${groupMembers} o where o.group_id = ${groupMembers.groupId} and o.role = 'admin' and o.user_id <> ${p.id})
        and exists (select 1 from ${groupMembers} o where o.group_id = ${groupMembers.groupId} and o.user_id <> ${p.id})`,
  );
if (soleAdmin.length) throw new Error(`${username} is the only admin of ${soleAdmin.length} shared group(s): hand the role over first`);

const solo = (
  await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, p.id))
    .groupBy(groupMembers.groupId)
    .having(sql`(select count(*) from ${groupMembers} m where m.group_id = ${groupMembers.groupId}) = 1`)
).map((g) => g.id);

if (solo.length) {
  const files = await db.select({ id: attachments.id, groupId: attachments.groupId }).from(attachments).where(inArray(attachments.groupId, solo));
  await deleteObjects(files.map((f) => objectKey(f.groupId, f.id)));
}
// Their files in shared groups go too (the rows cascade with the profile).
const shared = await db.select({ id: attachments.id, groupId: attachments.groupId }).from(attachments).where(eq(attachments.uploaderId, p.id));
await deleteObjects(shared.map((f) => objectKey(f.groupId, f.id)));
await db.transaction(async (tx) => {
  if (solo.length) {
    await tx.delete(joinAttempts).where(inArray(joinAttempts.groupId, solo));
    await tx.delete(groups).where(inArray(groups.id, solo));
  }
  // Members, keys, messages and attempts cascade; invites keep a null link.
  await tx.delete(profiles).where(eq(profiles.id, p.id));
});

const code = generateInviteCode();
const expiresAt = new Date(Date.now() + 2 * 3_600_000); // same as POST /invites
await db.insert(invites).values({ codeHash: sha256Hex(normalizeInviteCode(code)), expiresAt });
console.log(`Removed ${username} and ${solo.length} group(s) where it was alone.`);
console.log(`Invite: ${code}  (expires ${expiresAt.toISOString()})`);
await pool.end();

export {};
