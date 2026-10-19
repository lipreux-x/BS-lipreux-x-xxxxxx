import type { NeonWSContext } from '@neon/functions/hono';
import { pool } from './db/client';

/*
 * WebSocket fan-out (SPEC §6). Sockets are local to the isolate they land on,
 * so each isolate polls Postgres for new messages and pushes them to its own
 * clients who are members of the message's group. Polling stops when an
 * isolate has no clients, so the compute can still scale to zero.
 *
 * A message whose seq was allocated before a higher one but committed after
 * it would be missed by a pure `seq > cursor` query, so each poll also looks
 * back a few seconds and de-duplicates. Clients de-duplicate by id as well and
 * resync over HTTP after every reconnect, so the socket is a fast path only.
 *
 * Erased history (group_purges) goes out the same way, as a bare "reload this
 * group" signal: the phones fetch the conversation again.
 */

const POLL_MS = 1000;
const MAX_SOCKETS_PER_USER = 5;
const LOOKBACK_SECONDS = 10;
const HEARTBEAT_MS = 25_000;

const clients = new Map<NeonWSContext, string>(); // socket -> userId
const recentlySent = new Map<number, number>(); // seq -> time sent
const recentPurges = new Map<number, number>(); // purge seq -> time sent
let cursor: number | null = null;
let purgeCursor: number | null = null;
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let beatTimer: ReturnType<typeof setInterval> | undefined;

interface Row {
  id: string;
  seq: string; // bigint comes back as string
  client_id: string;
  group_id: string;
  sender_id: string;
  key_version: number;
  nonce: string;
  ciphertext: string;
  signature: string;
  created_at: Date;
  expires_at: Date | null;
  recipients: string[];
}

async function poll(): Promise<void> {
  if (polling || clients.size === 0) return;
  polling = true;
  try {
    if (cursor === null) {
      const { rows } = await pool.query<{ seq: string }>('select coalesce(max(seq), 0)::text as seq from messages');
      cursor = Number(rows[0]!.seq);
    }
    const userIds = [...new Set(clients.values())];
    const { rows } = await pool.query<Row>(
      `select m.*, array_agg(gm.user_id::text) as recipients
         from messages m
         join group_members gm on gm.group_id = m.group_id and gm.user_id = any($2::uuid[])
         join groups g on g.id = m.group_id and (g.expires_at is null or g.expires_at > now())
        where (m.seq > $1 or m.created_at > now() - make_interval(secs => $3))
          and (m.expires_at is null or m.expires_at > now())
        group by m.id
        order by m.seq
        limit 500`,
      [cursor, userIds, LOOKBACK_SECONDS],
    );

    const now = Date.now();
    for (const row of rows) {
      const seq = Number(row.seq);
      if (seq > cursor) cursor = seq;
      if (recentlySent.has(seq)) continue;
      recentlySent.set(seq, now);
      const frame = JSON.stringify({
        type: 'message',
        message: {
          id: row.id,
          seq,
          clientId: row.client_id,
          groupId: row.group_id,
          senderId: row.sender_id,
          keyVersion: row.key_version,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          signature: row.signature,
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at?.toISOString() ?? null,
        },
      });
      const recipients = new Set(row.recipients);
      for (const [ws, userId] of clients) {
        if (recipients.has(userId) && ws.readyState === 1) ws.send(frame);
      }
    }
    for (const [seq, t] of recentlySent) if (now - t > (LOOKBACK_SECONDS + 20) * 1000) recentlySent.delete(seq);
    await pollPurges(userIds, now);
  } catch (err) {
    console.error('[realtime] poll failed', (err as Error).name);
  } finally {
    polling = false;
  }
}

async function pollPurges(userIds: string[], now: number): Promise<void> {
  if (purgeCursor === null) {
    const { rows } = await pool.query<{ seq: string }>('select coalesce(max(seq), 0)::text as seq from group_purges');
    purgeCursor = Number(rows[0]!.seq);
  }
  const { rows } = await pool.query<{ seq: string; group_id: string; recipients: string[] }>(
    `select p.seq, p.group_id, array_agg(gm.user_id::text) as recipients
       from group_purges p
       join group_members gm on gm.group_id = p.group_id and gm.user_id = any($2::uuid[])
      where p.seq > $1 or p.created_at > now() - make_interval(secs => $3)
      group by p.seq
      order by p.seq
      limit 100`,
    [purgeCursor, userIds, LOOKBACK_SECONDS],
  );
  for (const row of rows) {
    const seq = Number(row.seq);
    if (seq > purgeCursor) purgeCursor = seq;
    if (recentPurges.has(seq)) continue;
    recentPurges.set(seq, now);
    const frame = JSON.stringify({ type: 'purge', groupId: row.group_id, seq });
    const recipients = new Set(row.recipients);
    for (const [ws, userId] of clients) {
      if (recipients.has(userId) && ws.readyState === 1) ws.send(frame);
    }
  }
  for (const [seq, t] of recentPurges) if (now - t > (LOOKBACK_SECONDS + 20) * 1000) recentPurges.delete(seq);
}

function heartbeat(): void {
  // Application-level ping: proxies drop silent sockets well before Neon's 15 min.
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send('{"type":"ping"}');
}

function start(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void poll(), POLL_MS);
  beatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  pollTimer.unref?.();
  beatTimer.unref?.();
}

function stop(): void {
  clearInterval(pollTimer);
  clearInterval(beatTimer);
  pollTimer = beatTimer = undefined;
  cursor = purgeCursor = null; // re-seed on next connection; clients resync over HTTP anyway
  recentlySent.clear();
  recentPurges.clear();
}

const expiries = new Map<NeonWSContext, ReturnType<typeof setTimeout>>();

export const realtime = {
  /** `expiresAt`: the access token's expiry; the socket closes then (the phone reconnects with a fresh one). */
  add(ws: NeonWSContext, userId: string, expiresAt: number): void {
    const mine = [...clients].filter(([, u]) => u === userId).map(([s]) => s);
    // Oldest out first: a phone that lost track of its sockets is not locked out.
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SOCKETS_PER_USER + 1))) {
      realtime.remove(old);
      old.close(4008, 'too_many_sockets');
    }
    clients.set(ws, userId);
    const t = setTimeout(() => {
      realtime.remove(ws);
      ws.close(4001, 'token_expired');
    }, Math.max(0, expiresAt - Date.now()));
    t.unref?.();
    expiries.set(ws, t);
    ws.send('{"type":"ready"}');
    start();
  },
  remove(ws: NeonWSContext): void {
    clearTimeout(expiries.get(ws));
    expiries.delete(ws);
    clients.delete(ws);
    if (clients.size === 0) stop();
  },
  /** Called after a local insert (or erase) so this isolate's clients get it without waiting a full tick. */
  nudge(): void {
    if (clients.size > 0) setTimeout(() => void poll(), 0);
  },
};

process.on('SIGINT', stop);
