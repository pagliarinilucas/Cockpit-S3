// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Metadata de objetos cifrados e flag de criptografia por bucket. */
import { and, eq, sql } from 'drizzle-orm';
import { db, sqlite } from '../db';
import { objects, bucketCrypto } from '../db/schema';

export interface ObjectRow {
  bucketId: string;
  key: string;
  s3Key: string;
  encrypted?: number;
  dekWrapped: Buffer;
  kekVersion: number;
  streamHeader: Buffer;
  chunkSize?: number;
  sizePlain: number;
  sizeCipher: number;
  contentType?: string | null;
}

export const objectsStore = {
  get(bucketId: string, key: string) {
    return db.select().from(objects).where(and(eq(objects.bucketId, bucketId), eq(objects.key, key))).get() ?? null;
  },
  getByS3Key(bucketId: string, s3Key: string) {
    return db.select().from(objects).where(and(eq(objects.bucketId, bucketId), eq(objects.s3Key, s3Key))).get() ?? null;
  },
  /** Conjunto de todos os s3_key (UUID opacos) do bucket — usado p/ ocultá-los da listagem. */
  listS3Keys(bucketId: string): Set<string> {
    return new Set(
      db.select({ s3Key: objects.s3Key }).from(objects).where(eq(objects.bucketId, bucketId)).all().map((r) => r.s3Key),
    );
  },
  listPrefix(bucketId: string, prefix: string) {
    // Escapa \, % e _ (nessa ordem) e usa ESCAPE explícito — sem isso o SQLite trata
    // o backslash como caractere literal e não neutraliza % / _ no prefixo do usuário.
    const pat = prefix.replace(/[\\%_]/g, '\\$&') + '%';
    return db.select().from(objects)
      .where(and(eq(objects.bucketId, bucketId), sql`${objects.key} LIKE ${pat} ESCAPE '\\'`))
      .all();
  },
  /** Insere/atualiza a linha e devolve o s3_key anterior (p/ deletar o blob velho). Atômico (WAL serializa o writer). */
  upsertReturningOld(row: ObjectRow): { oldS3Key: string | null } {
    const tx = sqlite.transaction(() => {
      const prev = db.select({ s3Key: objects.s3Key }).from(objects)
        .where(and(eq(objects.bucketId, row.bucketId), eq(objects.key, row.key))).get();
      db.insert(objects).values({
        bucketId: row.bucketId, key: row.key, s3Key: row.s3Key, encrypted: 1,
        dekWrapped: row.dekWrapped, kekVersion: row.kekVersion, streamHeader: row.streamHeader,
        chunkSize: row.chunkSize ?? 1048576, sizePlain: row.sizePlain, sizeCipher: row.sizeCipher,
        contentType: row.contentType ?? null, createdAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [objects.bucketId, objects.key],
        set: {
          s3Key: row.s3Key, dekWrapped: row.dekWrapped, kekVersion: row.kekVersion,
          streamHeader: row.streamHeader, sizePlain: row.sizePlain, sizeCipher: row.sizeCipher,
          contentType: row.contentType ?? null,
        },
      }).run();
      return prev?.s3Key ?? null;
    });
    return { oldS3Key: tx() };
  },
  remove(bucketId: string, key: string): { s3Key: string } | null {
    const existing = db.select({ s3Key: objects.s3Key }).from(objects)
      .where(and(eq(objects.bucketId, bucketId), eq(objects.key, key))).get();
    if (!existing) return null;
    db.delete(objects).where(and(eq(objects.bucketId, bucketId), eq(objects.key, key))).run();
    return { s3Key: existing.s3Key };
  },
};

export const bucketCryptoStore = {
  isEnabled(bucketId: string): boolean {
    const r = db.select({ enabled: bucketCrypto.enabled }).from(bucketCrypto).where(eq(bucketCrypto.bucketId, bucketId)).get();
    return !!r && r.enabled === 1;
  },
  setEnabled(bucketId: string, enabled: boolean): void {
    db.insert(bucketCrypto).values({ bucketId, enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: bucketCrypto.bucketId, set: { enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() } })
      .run();
  },
};
