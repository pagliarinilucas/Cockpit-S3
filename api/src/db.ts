import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath, { create: true });
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    token_version INTEGER NOT NULL DEFAULT 1,
    grants        TEXT NOT NULL DEFAULT '{}',   -- JSON: { bucketId: perm }
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login    TEXT
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,             -- session (refresh) id
    family_id   TEXT NOT NULL,                -- rotation family
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,         -- sha256(refresh token)
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT,                         -- set when rotated
    rotated_to  TEXT,                         -- next session id in family
    revoked     INTEGER NOT NULL DEFAULT 0,
    user_agent  TEXT
  );
`);
db.run('CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id)');
db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username)');

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS connections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    region      TEXT NOT NULL DEFAULT 'garage',
    access_key  TEXT NOT NULL,
    secret_key  TEXT NOT NULL,
    buckets     TEXT NOT NULL DEFAULT '[]',   -- JSON array (override; empty = ListBuckets)
    created_at  TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    action  TEXT NOT NULL,
    actor   TEXT NOT NULL,
    bucket  TEXT NOT NULL DEFAULT '—',
    target  TEXT NOT NULL DEFAULT '',
    at      TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS user_groups (
    username  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    group_id  TEXT NOT NULL REFERENCES groups(id)     ON DELETE CASCADE,
    PRIMARY KEY (username, group_id)
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS grants (
    subject_type TEXT NOT NULL,             -- 'user' | 'group'
    subject_id   TEXT NOT NULL,             -- username | group id
    bucket_id    TEXT NOT NULL,             -- connectionId:bucketName
    prefix       TEXT NOT NULL DEFAULT '',  -- '' = bucket todo; senão termina em '/'
    perm         TEXT NOT NULL,             -- owner|read-write|read-only
    PRIMARY KEY (subject_type, subject_id, bucket_id, prefix)
  );
`);
db.run('CREATE INDEX IF NOT EXISTS idx_grants_subject ON grants(subject_type, subject_id)');
db.run('CREATE INDEX IF NOT EXISTS idx_grants_bucket  ON grants(bucket_id)');

db.run(`
  CREATE TABLE IF NOT EXISTS user_blocks (
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    bucket_id  TEXT NOT NULL,
    prefix     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (username, bucket_id, prefix)
  );
`);

// One-time migration: legacy users.grants JSON -> grants rows (prefix='' = whole bucket).
// Idempotent; guarded by a settings flag. The users.grants column stays but is unused after.
if (!db.query("SELECT 1 FROM settings WHERE key = 'grants_migrated'").get()) {
  const rows = db.query('SELECT username, grants FROM users').all() as { username: string; grants: string }[];
  const ins = db.query(
    "INSERT OR IGNORE INTO grants (subject_type, subject_id, bucket_id, prefix, perm) VALUES ('user', ?, ?, '', ?)",
  );
  for (const r of rows) {
    let g: Record<string, string | null> = {};
    try { g = JSON.parse(r.grants || '{}'); } catch { /* skip malformed */ }
    for (const [bucketId, perm] of Object.entries(g)) if (perm) ins.run(r.username, bucketId, perm);
  }
  db.query("INSERT INTO settings (key, value) VALUES ('grants_migrated', '1')").run();
}
