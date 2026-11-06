import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { account } from './routes/account';
import { auth } from './routes/auth';
import { groupSettings } from './routes/groupSettings';
import { groupsRoutes } from './routes/groups';
import { internal } from './routes/internal';
import { messagesRoutes } from './routes/messages';
import { requireAuth, type Env } from './routes/_shared';

/*
 * The HTTP API (SPEC §4). Routes live in ./routes/*, grouped by area and
 * mounted below; the shared middleware, validation and DB helpers are in
 * ./routes/_shared.ts. Everything the server stores is ciphertext, public
 * keys or hashes; the phones verify what matters (./routes/groups.ts).
 */

export const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  // Never log request data: only the error class (SPEC §4.7), and for a
  // failed query the SQLSTATE of its cause (drizzle's own error is a bare
  // "Error" by name: a missing column read as nothing at all on 25/10).
  const cause = (err as { cause?: { code?: unknown } }).cause;
  console.error('[error]', err.constructor.name, typeof cause?.code === 'string' ? cause.code : '');
  return c.json({ error: 'internal' }, 500);
});

// A code change re-sends every key handout of the group: a bigger body.
const smallBody = bodyLimit({ maxSize: 128 * 1024 });
// Routes that carry a handout per member (rotation, code change, labelling) can run to a few hundred KiB.
const largeBody = bodyLimit({ maxSize: 2 * 1024 * 1024 });
const bigBodyPath = (p: string) => p.endsWith('/code') || p.endsWith('/rotate') || p.endsWith('/keys/labels') || p.endsWith('/admins');
app.use('*', (c, next) => (['PUT', 'POST'].includes(c.req.method) && bigBodyPath(c.req.path) ? largeBody : smallBody)(c, next));

app.get('/health', (c) => c.json({ ok: true }));

// Public: invite-only registration, then device-key challenge login.
app.route('/', auth);

// ---- Everything below requires a valid access token -------------------------

app.use('/me', requireAuth);
app.use('/me/*', requireAuth);
app.use('/invites/*', requireAuth);
app.use('/invites', requireAuth);
app.use('/profiles', requireAuth);
app.use('/groups', requireAuth);
app.use('/groups/*', requireAuth);

app.route('/', account);
app.route('/', groupsRoutes);
app.route('/', groupSettings);
app.route('/', messagesRoutes);

// Realtime (token in the query) and the scheduled purge (trigger header): their own auth.
app.route('/', internal);
