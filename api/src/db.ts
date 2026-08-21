// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import * as schema from './db/schema';

mkdirSync(dirname(config.dbPath), { recursive: true });

// Raw bun:sqlite handle — usado só para garantir o schema (idempotente) e o backfill único.
export const sqlite = new Database(config.dbPath, { create: true });
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA foreign_keys = ON');

// Drizzle ORM por cima do mesmo handle — é o que os stores usam para queries tipadas.
export const db = drizzle({ client: sqlite, schema });

// Schema garantido no boot (idempotente). Cobre DB novo, DB legado (5 tabelas) e DB já migrado.
// As mudanças FUTURAS de schema devem ser geradas com `bun run db:generate`.
sqlite.run(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    token_version INTEGER NOT NULL DEFAULT 1,
    grants        TEXT NOT NULL DEFAULT '{}',   -- JSON legado: { bucketId: perm }
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login    TEXT
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    family_id   TEXT NOT NULL,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT,
    rotated_to  TEXT,
    revoked     INTEGER NOT NULL DEFAULT 0,
    user_agent  TEXT
  );
`);
sqlite.run('CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id)');
sqlite.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username)');

sqlite.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS bucket_aliases (
    bucket_id  TEXT PRIMARY KEY,
    alias      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS connections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    region      TEXT NOT NULL DEFAULT 'garage',
    access_key  TEXT NOT NULL,
    secret_key  TEXT NOT NULL,
    buckets     TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS clusters (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    admin_endpoint  TEXT NOT NULL,
    admin_token     TEXT NOT NULL,
    s3_endpoint     TEXT NOT NULL,
    region          TEXT NOT NULL DEFAULT 'garage',
    internal_key_id TEXT,
    internal_secret TEXT,
    created_at      TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    action  TEXT NOT NULL,
    actor   TEXT NOT NULL,
    bucket  TEXT NOT NULL DEFAULT '—',
    target  TEXT NOT NULL DEFAULT '',
    at      TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS user_groups (
    username  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    group_id  TEXT NOT NULL REFERENCES groups(id)     ON DELETE CASCADE,
    PRIMARY KEY (username, group_id)
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS grants (
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    bucket_id    TEXT NOT NULL,
    prefix       TEXT NOT NULL DEFAULT '',
    perm         TEXT NOT NULL,
    PRIMARY KEY (subject_type, subject_id, bucket_id, prefix)
  );
`);
sqlite.run('CREATE INDEX IF NOT EXISTS idx_grants_subject ON grants(subject_type, subject_id)');
sqlite.run('CREATE INDEX IF NOT EXISTS idx_grants_bucket  ON grants(bucket_id)');

sqlite.run(`
  CREATE TABLE IF NOT EXISTS user_blocks (
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    bucket_id  TEXT NOT NULL,
    prefix     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (username, bucket_id, prefix)
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS shares (
    token       TEXT PRIMARY KEY,
    bucket_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    created_by  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    lock_ip     INTEGER NOT NULL DEFAULT 0,
    bound_ip    TEXT
  );
`);
sqlite.run('CREATE INDEX IF NOT EXISTS idx_shares_creator ON shares(created_by)');

sqlite.run(`
  CREATE TABLE IF NOT EXISTS org_keys (
    org_id     TEXT NOT NULL,
    version    INTEGER NOT NULL,
    kek_state  TEXT NOT NULL,       -- 'plaintext_env' | 'sealed'
    verifier   BLOB NOT NULL,       -- sentinela cifrado com a KEK (fail-fast)
    created_at TEXT NOT NULL,
    retired_at TEXT,
    PRIMARY KEY (org_id, version)
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS objects (
    bucket_id     TEXT NOT NULL,    -- connectionId:bucketName
    key           TEXT NOT NULL,    -- caminho+nome REAL exibido ao usuário
    s3_key        TEXT NOT NULL,    -- UUID opaco usado no bucket
    encrypted     INTEGER NOT NULL DEFAULT 1,
    dek_wrapped   BLOB NOT NULL,
    kek_version   INTEGER NOT NULL,
    stream_header BLOB NOT NULL,
    chunk_size    INTEGER NOT NULL DEFAULT 1048576,
    size_plain    INTEGER NOT NULL,
    size_cipher   INTEGER NOT NULL,
    content_type  TEXT,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (bucket_id, key)
  );
`);
sqlite.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_s3key ON objects(bucket_id, s3_key)');

sqlite.run(`
  CREATE TABLE IF NOT EXISTS bucket_crypto (
    bucket_id  TEXT PRIMARY KEY,    -- connectionId:bucketName
    enabled    INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS sheet_docs (
    doc_id       TEXT PRIMARY KEY,   -- sha256(bucket_id \\0 key)
    bucket_id    TEXT NOT NULL,
    key          TEXT NOT NULL,
    fingerprint  TEXT,               -- estado do objeto no S3 na abertura do doc
    dek_wrapped  BLOB NOT NULL,
    kek_version  INTEGER NOT NULL,
    snapshot     BLOB NOT NULL,      -- update Yjs cifrado
    snapshot_seq INTEGER NOT NULL DEFAULT 0,
    dirty        INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS sheet_updates (
    doc_id      TEXT NOT NULL REFERENCES sheet_docs(doc_id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    blob        BLOB NOT NULL,       -- update Yjs cifrado
    author_user TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (doc_id, seq)
  );
`);

sqlite.run(`
  CREATE TABLE IF NOT EXISTS escrow_config (
    id              TEXT PRIMARY KEY,
    enabled         INTEGER NOT NULL DEFAULT 0,
    client_dest     TEXT,
    vendor_enabled  INTEGER NOT NULL DEFAULT 0,
    recovery_secret TEXT,
    recovery_shown  INTEGER NOT NULL DEFAULT 0,
    last_backup_at  TEXT,
    last_status     TEXT,
    last_error      TEXT,
    last_count      INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL
  );
`);

// Additive migration (idempotent): users.can_share for DBs created before share links existed.
{
  const cols = sqlite.query('PRAGMA table_info(users)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'can_share')) {
    sqlite.run('ALTER TABLE users ADD COLUMN can_share INTEGER NOT NULL DEFAULT 0');
  }
}

// One-time migration: legacy users.grants JSON -> grants rows (prefix='' = whole bucket).
// Idempotent; guarded by a settings flag. The users.grants column stays but is unused after.
if (!sqlite.query("SELECT 1 FROM settings WHERE key = 'grants_migrated'").get()) {
  const rows = sqlite.query('SELECT username, grants FROM users').all() as { username: string; grants: string }[];
  const ins = sqlite.query(
    "INSERT OR IGNORE INTO grants (subject_type, subject_id, bucket_id, prefix, perm) VALUES ('user', ?, ?, '', ?)",
  );
  for (const r of rows) {
    let g: Record<string, string | null> = {};
    try { g = JSON.parse(r.grants || '{}'); } catch { /* skip malformed */ }
    for (const [bucketId, perm] of Object.entries(g)) if (perm) ins.run(r.username, bucketId, perm);
  }
  sqlite.query("INSERT INTO settings (key, value) VALUES ('grants_migrated', '1')").run();
}
