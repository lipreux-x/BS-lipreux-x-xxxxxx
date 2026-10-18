import { sql } from 'drizzle-orm';
import {
  bigserial,
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

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  publicKeyBox: text('public_key_box').notNull(), // X25519, base64url
  publicKeySign: text('public_key_sign').notNull(), // Ed25519, base64url
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  codeHash: text('code_hash').primaryKey(), // SHA-256 of a high-entropy code
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  usedBy: uuid('used_by').references(() => profiles.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(), // chosen by the client: it is bound into encrypted_meta
  encryptedMeta: text('encrypted_meta').notNull(),
  codeHash: text('code_hash').notNull(), // Argon2id (encoded) of the group code
  // HMAC-SHA256(GROUP_CODE_PEPPER, code): finds the group from the code alone.
  // Unique, so two groups cannot share a code. Null for groups created before.
  codeLookup: text('code_lookup').unique(),
  currentKeyVersion: integer('current_key_version').notNull().default(1),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  ephemeralSeconds: integer('ephemeral_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    sealedKey: text('sealed_key').notNull(), // crypto_box_seal(group key, member X25519 key)
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    // Offline replays: the same phone resending the same message is a no-op.
    uniqueIndex('messages_sender_client_idx').on(t.senderId, t.clientId),
    index('messages_group_seq_idx').on(t.groupId, t.seq),
    index('messages_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
  ],
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
  (t) => [index('join_attempts_user_time_idx').on(t.userId, t.attemptedAt)],
);
