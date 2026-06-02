import { db } from '../db';

export interface ConnInput {
  name: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  buckets: string[];
}
/** Full connection incl. secret — server-side only. */
export interface ConnFull extends ConnInput { id: string; createdAt: string; }
/** Safe view sent to clients — no secret. */
export interface ConnPublic {
  id: string; name: string; endpoint: string; region: string;
  accessKey: string; buckets: string[]; secretSet: boolean; createdAt: string;
}

interface Row {
  id: string; name: string; endpoint: string; region: string;
  access_key: string; secret_key: string; buckets: string; created_at: string;
}

function full(r: Row): ConnFull {
  let buckets: string[] = [];
  try { buckets = JSON.parse(r.buckets); } catch { /* [] */ }
  return { id: r.id, name: r.name, endpoint: r.endpoint, region: r.region, accessKey: r.access_key, secretKey: r.secret_key, buckets, createdAt: r.created_at };
}
function pub(c: ConnFull): ConnPublic {
  const { secretKey, ...rest } = c;
  return { ...rest, secretSet: !!secretKey };
}
function newId(): string {
  return 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 11);
}

export const connectionsStore = {
  listFull(): ConnFull[] {
    return (db.query('SELECT * FROM connections ORDER BY created_at').all() as Row[]).map(full);
  },
  list(): ConnPublic[] {
    return this.listFull().map(pub);
  },
  count(): number {
    return (db.query('SELECT COUNT(*) AS n FROM connections').get() as { n: number }).n;
  },
  getFull(id: string): ConnFull | null {
    const r = db.query('SELECT * FROM connections WHERE id = ?').get(id) as Row | null;
    return r ? full(r) : null;
  },
  get(id: string): ConnPublic | null {
    const c = this.getFull(id);
    return c ? pub(c) : null;
  },
  exists(id: string): boolean {
    return !!db.query('SELECT 1 FROM connections WHERE id = ?').get(id);
  },
  create(input: ConnInput): ConnFull {
    const id = newId();
    db.query(`INSERT INTO connections (id, name, endpoint, region, access_key, secret_key, buckets, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.name, input.endpoint, input.region || 'garage', input.accessKey, input.secretKey,
           JSON.stringify(input.buckets ?? []), new Date().toISOString());
    return this.getFull(id)!;
  },
  update(id: string, input: ConnInput): ConnFull | null {
    if (!this.exists(id)) return null;
    db.query(`UPDATE connections SET name=?, endpoint=?, region=?, access_key=?, secret_key=?, buckets=? WHERE id=?`)
      .run(input.name, input.endpoint, input.region || 'garage', input.accessKey, input.secretKey,
           JSON.stringify(input.buckets ?? []), id);
    return this.getFull(id);
  },
  remove(id: string): void {
    db.query('DELETE FROM connections WHERE id = ?').run(id);
  },
};
