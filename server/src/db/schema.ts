import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// The server only ever stores public keys, ciphertext and hashes (SPEC §4.6).

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    publicKeyBox: text('public_key_box').notNull(), // X25519, base64url
    publicKeySign: text('public_key_sign').notNull(), // Ed25519, base64url
    // One of the avatar icons (AVATARS in app.ts), never an uploaded image.
    // Null: the default empty silhouette. Visible to group mates, like the username.
    avatar: text('avatar'),
    // Password-sealed copy of the identity secret keys, to sign in again on a
    // phone that lost its data (mobile src/crypto/backup.ts). Null: no backup.
    backupParams: text('backup_params'), // JSON { salt, ops, mem } handed out before sign-in
    backupAuth: text('backup_auth'), // HMAC(pepper, authKey): sign-in proof, never the key itself
    backupBox: text('backup_box'), // the sealed identity, re-encrypted with a server key at rest
    // The app is open on one of this person's phones until then (PUT /me/presence,
    // renewed every 30 s): no "new message" push meanwhile, the open app shows it.
    awakeUntil: timestamp('awake_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // "Alice" and "alice" cannot both exist: no look-alike names in a member list.
  (t) => [uniqueIndex('profiles_username_lower_idx').on(sql`lower(${t.username})`)],
);

export const invites = pgTable('invites', {
  codeHash: text('code_hash').primaryKey(), // SHA-256 of a high-entropy code
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  usedBy: uuid('used_by').references(() => profiles.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Sign-ups refused because the username was taken: the invite burns after a
  // few, so one invite cannot test which usernames exist.
  failedUses: integer('failed_uses').notNull().default(0),
});

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey(), // chosen by the client: it is bound into encrypted_meta
    // Name, keywords, admins and members, encrypted under the current group
    // key and signed by the admin who wrote it (mobile src/crypto/group.ts):
    // the server can neither read nor forge it.
    encryptedMeta: text('encrypted_meta').notNull(),
    metaSignerId: uuid('meta_signer_id').notNull(),
    metaSignature: text('meta_signature').notNull(),
    // HMAC(GROUP_CODE_PEPPER, joinKey): joinKey is derived on the phone from
    // the group code + keywords, which the server never sees (lib/crypto.ts).
    joinLookup: text('join_lookup').notNull().unique(),
    currentKeyVersion: integer('current_key_version').notNull().default(1),
    // Set when a member leaves or is removed: the next member who opens the
    // group draws a new key for those who remain (POST /groups/:id/rotate).
    rotationPending: boolean('rotation_pending').notNull().default(false),
    // Bumped when the admin changes the code: members' phones then ask for the
    // new one to re-lock the group key locally.
    codeVersion: integer('code_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ephemeralSeconds: integer('ephemeral_seconds'),
    // Self-destructing group: past this date it is hidden from everyone, then
    // deleted with all its messages and files by the purge (every 6 h).
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('groups_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    // Pending: asked to join with the right code + keywords, waiting for an
    // admin to approve (and hand over the key). Sees nothing of the group.
    status: text('status', { enum: ['pending', 'active'] }).notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('group_members_user_idx').on(t.userId)],
);

export const groupKeys = pgTable(
  'group_keys',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    keyVersion: integer('key_version').notNull(),
    // crypto_box_seal(AEAD(code+keywords key, group key), member X25519 key):
    // opening it needs both the member's identity and the group's code.
    sealedKey: text('sealed_key').notNull(),
    // The admin (or creator) who handed it over, and their Ed25519 signature:
    // phones accept a key only from an admin they trust.
    signerId: uuid('signer_id').notNull(),
    signature: text('signature').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId, t.keyVersion] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Monotonic cursor for resync and realtime fan-out.
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    clientId: uuid('client_id').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    keyVersion: integer('key_version').notNull(),
    nonce: text('nonce').notNull(),
    ciphertext: text('ciphertext').notNull(),
    signature: text('signature').notNull(),
    // A reaction or the like: relayed like any message, but nobody is notified
    // and it does not count as unread (the server learns only that much).
    quiet: boolean('quiet').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    // Offline replays: the same phone resending the same message is a no-op.
    uniqueIndex('messages_sender_client_idx').on(t.senderId, t.clientId),
    index('messages_group_seq_idx').on(t.groupId, t.seq),
    index('messages_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    index('messages_sender_time_idx').on(t.senderId, t.createdAt), // send rate limit
  ],
);

/**
 * Encrypted files (images, voice messages) in object storage, at key `<group_id>/<id>`. The
 * server never sees the file key: it travels inside the message. A row is
 * created before the upload and linked to its message when that is sent;
 * the object is deleted with the message (expiry) or when never linked.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    size: integer('size').notNull(), // encrypted bytes, signed into the upload URL
    // Set null (not cascade) when the message goes: the row stays as the
    // pointer to the stored object until the purge deletes both.
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_group_idx').on(t.groupId),
    index('attachments_message_idx').on(t.messageId),
    index('attachments_unlinked_idx').on(t.createdAt).where(sql`${t.messageId} is null`),
  ],
);

/**
 * One row each time an admin erases a span of a group's history. Phones
 * holding the conversation compare the latest seq (realtime or resync) and
 * reload it. Nothing about the erased messages is kept.
 */
export const groupPurges = pgTable(
  'group_purges',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('group_purges_group_idx').on(t.groupId, t.seq)],
);

export const joinAttempts = pgTable(
  'join_attempts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'), // null: code matched no group
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('join_attempts_user_time_idx').on(t.userId, t.attemptedAt),
    index('join_attempts_group_time_idx').on(t.groupId, t.attemptedAt),
  ],
);

/** Failed sign-ins with a password, per username: rate limit (SPEC §4.5). */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    username: text('username').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('login_attempts_user_time_idx').on(t.username, t.attemptedAt),
    index('login_attempts_time_idx').on(t.attemptedAt),
  ],
);

/**
 * Members removed by an admin: they cannot join the group again, even with
 * the code and keywords they still know.
 */
export const groupBans = pgTable(
  'group_bans',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** Costly or abusable actions per user (invites, group codes): quotas. */
export const userActions = pgTable(
  'user_actions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['invite', 'group_code'] }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_actions_user_time_idx').on(t.userId, t.action, t.at)],
);

/** Sign-in challenges already used: each one mints a single access token. */
export const usedChallenges = pgTable('used_challenges', {
  nonce: text('nonce').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// Push notifications (src/lib/push.ts): one Expo push token per phone. The
// server only ever sends a group id and an event kind; the token says where.
export const pushTokens = pgTable(
  'push_tokens',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    // Android phones get a silent push and show the notification themselves
    // (group name included); iOS and unknown get a visible generic line.
    platform: text('platform', { enum: ['ios', 'android'] }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Last notification sent to this phone (throttle).
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
  },
  (t) => [index('push_tokens_user_idx').on(t.userId)],
);
