import { eq, count } from 'drizzle-orm';
import { db } from '../db';
import { connections } from '../db/schema';

export interface ConnInput {
  name: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  buckets: string[];
  adminEndpoint?: string;
  adminToken?: string;
}
/** Full connection incl. secret — server-side only. */
export interface ConnFull extends ConnInput { id: string; createdAt: string; }
/** Safe view sent to clients — no secret. */
export interface ConnPublic {
  id: string; name: string; endpoint: string; region: string;
  accessKey: string; buckets: string[]; secretSet: boolean; createdAt: string;
  adminEndpoint?: string; adminConfigured: boolean;
}

type Row = typeof connections.$inferSelect;

function full(r: Row): ConnFull {
  let buckets: string[] = [];
  try { buckets = JSON.parse(r.buckets); } catch { /* [] */ }
  return {
    id: r.id, name: r.name, endpoint: r.endpoint, region: r.region,
    accessKey: r.accessKey, secretKey: r.secretKey, buckets, createdAt: r.createdAt,
    adminEndpoint: r.adminEndpoint ?? undefined, adminToken: r.adminToken ?? undefined,
  };
}
function pub(c: ConnFull): ConnPublic {
  const { secretKey, adminToken, ...rest } = c;
  return { ...rest, secretSet: !!secretKey, adminConfigured: !!(c.adminEndpoint && adminToken) };
}
export const connectionsStore = {
  listFull(): ConnFull[] {
    return db.select().from(connections).orderBy(connections.createdAt).all().map(full);
  },
  list(): ConnPublic[] {
    return this.listFull().map(pub);
  },
  count(): number {
    return db.select({ n: count() }).from(connections).get()?.n ?? 0;
  },
  getFull(id: string): ConnFull | null {
    const r = db.select().from(connections).where(eq(connections.id, id)).get();
    return r ? full(r) : null;
  },
  get(id: string): ConnPublic | null {
    const c = this.getFull(id);
    return c ? pub(c) : null;
  },
  exists(id: string): boolean {
    return !!db.select({ id: connections.id }).from(connections).where(eq(connections.id, id)).get();
  },
  create(input: ConnInput): ConnFull {
    const id = 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 11);
    db.insert(connections).values({
      id,
      name: input.name,
      endpoint: input.endpoint,
      region: input.region || 'garage',
      accessKey: input.accessKey,
      secretKey: input.secretKey,
      buckets: JSON.stringify(input.buckets ?? []),
      adminEndpoint: input.adminEndpoint || null,
      adminToken: input.adminToken || null,
      createdAt: new Date().toISOString(),
    }).run();
    return this.getFull(id)!;
  },
  update(id: string, input: ConnInput): ConnFull | null {
    if (!this.exists(id)) return null;
    db.update(connections).set({
      name: input.name,
      endpoint: input.endpoint,
      region: input.region || 'garage',
      accessKey: input.accessKey,
      secretKey: input.secretKey,
      buckets: JSON.stringify(input.buckets ?? []),
      adminEndpoint: input.adminEndpoint || null,
      adminToken: input.adminToken || null,
    }).where(eq(connections.id, id)).run();
    return this.getFull(id);
  },
  remove(id: string): void {
    db.delete(connections).where(eq(connections.id, id)).run();
  },
};
