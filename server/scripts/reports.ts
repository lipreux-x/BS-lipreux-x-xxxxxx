// Reports sent from the app (POST /groups/:groupId/reports), oldest open first.
// Usage: npx tsx scripts/reports.ts [--prod] [--all] [--done <report id>]
//   default: dev branch (.env); --prod: main branch (.env.production)
//   --all: handled ones too; --done: marks one as handled
const prod = process.argv.includes('--prod');
process.loadEnvFile(prod ? '.env.production' : '.env');

const { asc, eq, isNull } = await import('drizzle-orm');
const { db, pool } = await import('../src/db/client');
const { profiles, reports } = await import('../src/db/schema');

const done = process.argv.indexOf('--done');
if (done !== -1) {
  const id = process.argv[done + 1] ?? '';
  const rows = await db.update(reports).set({ handledAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
  console.log(rows.length ? `Handled: ${id}` : `No report ${id}`);
} else {
  const rows = await db
    .select({ r: reports, reporter: profiles.username })
    .from(reports)
    .leftJoin(profiles, eq(profiles.id, reports.reporterId))
    .where(process.argv.includes('--all') ? undefined : isNull(reports.handledAt))
    .orderBy(asc(reports.createdAt));
  console.log(`${rows.length} report(s) (${prod ? 'production' : 'dev'})`);
  for (const { r, reporter } of rows) {
    console.log(
      [
        `\n${r.id}  ${r.createdAt.toISOString()}${r.handledAt ? `  handled ${r.handledAt.toISOString()}` : ''}`,
        `  ${r.reason}: ${r.reportedUsername} (${r.reportedId}), reported by ${reporter ?? '(deleted account)'}`,
        `  group ${r.groupId}${r.messageId ? `, message ${r.messageId}` : ''}`,
        r.excerpt ? `  « ${r.excerpt} »` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}
await pool.end();

export {};
