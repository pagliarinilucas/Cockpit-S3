import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import type { Perm, Role } from '../types';

// Espelha EXATAMENTE o schema criado em src/db.ts (CREATE TABLE IF NOT EXISTS).
// Chaves TS em camelCase; nomes de coluna no banco em snake_case (1o arg de text/integer).

export const users = sqliteTable('users', {
  username: text('username').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull().default('user'),
  tokenVersion: integer('token_version').notNull().default(1),
  grants: text('grants').notNull().default('{}'), // coluna legada (JSON antigo), mantida
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  lastLogin: text('last_login'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    username: text('username')
      .notNull()
      .references(() => users.username, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    rotatedTo: text('rotated_to'),
    revoked: integer('revoked').notNull().default(0),
    userAgent: text('user_agent'),
  },
  (t) => ({
    familyIdx: index('idx_sessions_family').on(t.familyId),
    userIdx: index('idx_sessions_user').on(t.username),
  }),
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const bucketAliases = sqliteTable('bucket_aliases', {
  bucketId: text('bucket_id').primaryKey(), // id composto `<cid>:<bucket>`
  alias: text('alias').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('garage'),
  accessKey: text('access_key').notNull(),
  secretKey: text('secret_key').notNull(),
  buckets: text('buckets').notNull().default('[]'), // JSON array (override; vazio = ListBuckets)
  createdAt: text('created_at').notNull(),
});

export const clusters = sqliteTable('clusters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adminEndpoint: text('admin_endpoint').notNull(),
  adminToken: text('admin_token').notNull(),
  s3Endpoint: text('s3_endpoint').notNull(),
  region: text('region').notNull().default('garage'),
  internalKeyId: text('internal_key_id'),
  internalSecret: text('internal_secret'),
  createdAt: text('created_at').notNull(),
});

export const activity = sqliteTable('activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  bucket: text('bucket').notNull().default('—'),
  target: text('target').notNull().default(''),
  at: text('at').notNull(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const userGroups = sqliteTable(
  'user_groups',
  {
    username: text('username')
      .notNull()
      .references(() => users.username, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.username, t.groupId] }) }),
);

export const grants = sqliteTable(
  'grants',
  {
    subjectType: text('subject_type').notNull(), // 'user' | 'group'
    subjectId: text('subject_id').notNull(), // username | group id
    bucketId: text('bucket_id').notNull(), // connectionId:bucketName
    prefix: text('prefix').notNull().default(''), // '' = bucket todo; senão termina em '/'
    perm: text('perm').$type<Perm>().notNull(), // owner|read-write|read-only
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subjectType, t.subjectId, t.bucketId, t.prefix] }),
    subjectIdx: index('idx_grants_subject').on(t.subjectType, t.subjectId),
    bucketIdx: index('idx_grants_bucket').on(t.bucketId),
  }),
);

export const userBlocks = sqliteTable(
  'user_blocks',
  {
    username: text('username')
      .notNull()
      .references(() => users.username, { onDelete: 'cascade' }),
    bucketId: text('bucket_id').notNull(),
    prefix: text('prefix').notNull().default(''),
  },
  (t) => ({ pk: primaryKey({ columns: [t.username, t.bucketId, t.prefix] }) }),
);
