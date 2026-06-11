import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { bucketAliases } from '../db/schema';

export const bucketAliasStore = {
  /** Apelido de um bucket, ou null se não houver. */
  get(bucketId: string): string | null {
    const row = db.select({ alias: bucketAliases.alias }).from(bucketAliases)
      .where(eq(bucketAliases.bucketId, bucketId)).get();
    return row?.alias ?? null;
  },
  /** Mapa id→alias para uma lista de ids (1 query). */
  getMany(ids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const rows = db.select({ bucketId: bucketAliases.bucketId, alias: bucketAliases.alias })
      .from(bucketAliases).where(inArray(bucketAliases.bucketId, ids)).all();
    for (const r of rows) out.set(r.bucketId, r.alias);
    return out;
  },
  /** Define (upsert) o apelido. */
  set(bucketId: string, alias: string): void {
    const updatedAt = new Date().toISOString();
    db.insert(bucketAliases).values({ bucketId, alias, updatedAt })
      .onConflictDoUpdate({ target: bucketAliases.bucketId, set: { alias, updatedAt } })
      .run();
  },
  /** Remove o apelido (volta ao padrão = nome do bucket). */
  clear(bucketId: string): void {
    db.delete(bucketAliases).where(eq(bucketAliases.bucketId, bucketId)).run();
  },
};
