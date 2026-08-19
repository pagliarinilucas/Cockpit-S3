// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Persistência do documento vivo. Todo blob de estado (snapshot e updates) vai
 * cifrado no banco com uma DEK por documento, envelopada com a KEK — o mesmo
 * envelope dos objetos. Sempre cifra, inclusive em bucket sem criptografia:
 * enquanto a sessão está aberta o conteúdo da planilha existe no banco, e ele
 * não pode ficar em claro só porque o bucket não pediu criptografia.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import sodium from 'sodium-native';
import { db, sqlite } from '../db';
import { sheetDocs, sheetUpdates } from '../db/schema';
import { generateDek } from '../crypto/index';
import { getKekProvider } from '../crypto/kek';
import { AEAD_ABYTES, AEAD_NPUBBYTES, DEFAULT_ORG } from '../crypto/constants';

export interface DocRow {
  docId: string;
  bucketId: string;
  key: string;
  fingerprint: string | null;
  snapshotSeq: number;
  dirty: number;
}

/** Cada blob leva o próprio nonce: [nonce | ct+tag]. AD amarra o blob ao doc. */
function seal(plain: Uint8Array, dek: Buffer, docId: string): Buffer {
  const nonce = Buffer.alloc(AEAD_NPUBBYTES);
  sodium.randombytes_buf(nonce);
  const ct = Buffer.alloc(plain.length + AEAD_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, Buffer.from(plain), Buffer.from(docId), null, nonce, dek);
  return Buffer.concat([nonce, ct]);
}

function open(blob: Buffer, dek: Buffer, docId: string): Uint8Array {
  const nonce = blob.subarray(0, AEAD_NPUBBYTES);
  const ct = blob.subarray(AEAD_NPUBBYTES);
  const out = Buffer.alloc(ct.length - AEAD_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, ct, Buffer.from(docId), nonce, dek);
  return new Uint8Array(out);
}

function requireKek() {
  const kek = getKekProvider();
  if (!kek) throw new Error('sealed');
  return kek;
}

export const sheetStore = {
  find(docId: string): DocRow | null {
    const r = db.select({
      docId: sheetDocs.docId, bucketId: sheetDocs.bucketId, key: sheetDocs.key,
      fingerprint: sheetDocs.fingerprint, snapshotSeq: sheetDocs.snapshotSeq, dirty: sheetDocs.dirty,
    }).from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    return r ?? null;
  },

  /** Cria o doc com o snapshot inicial. Falha se a KEK não estiver disponível. */
  create(a: { docId: string; bucketId: string; key: string; fingerprint: string | null; snapshot: Uint8Array }): void {
    const kek = requireKek();
    const dek = generateDek();
    const { wrapped, version } = kek.wrapWithCurrent(DEFAULT_ORG, dek);
    db.insert(sheetDocs).values({
      docId: a.docId, bucketId: a.bucketId, key: a.key, fingerprint: a.fingerprint,
      dekWrapped: wrapped, kekVersion: version,
      snapshot: seal(a.snapshot, dek, a.docId), snapshotSeq: 0, dirty: 0,
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing().run();
    sodium.sodium_memzero(dek);
  },

  /** DEK desenvelopada do doc. O chamador é responsável por zerá-la. */
  dekOf(docId: string): Buffer {
    const row = db.select({ dekWrapped: sheetDocs.dekWrapped, kekVersion: sheetDocs.kekVersion })
      .from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    if (!row) throw new Error('doc_inexistente');
    return requireKek().unwrapDek(DEFAULT_ORG, row.kekVersion, row.dekWrapped as Buffer);
  },

  /** Snapshot + updates posteriores, em ordem, já decifrados. */
  load(docId: string): { updates: Uint8Array[]; seq: number } | null {
    const row = db.select({
      snapshot: sheetDocs.snapshot, snapshotSeq: sheetDocs.snapshotSeq,
      dekWrapped: sheetDocs.dekWrapped, kekVersion: sheetDocs.kekVersion,
    }).from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    if (!row) return null;

    const dek = requireKek().unwrapDek(DEFAULT_ORG, row.kekVersion, row.dekWrapped as Buffer);
    try {
      const updates = [open(row.snapshot as Buffer, dek, docId)];
      const rows = db.select({ seq: sheetUpdates.seq, blob: sheetUpdates.blob })
        .from(sheetUpdates)
        .where(and(eq(sheetUpdates.docId, docId), gt(sheetUpdates.seq, row.snapshotSeq)))
        .orderBy(asc(sheetUpdates.seq)).all();
      for (const u of rows) updates.push(open(u.blob as Buffer, dek, docId));
      const seq = rows.length ? rows[rows.length - 1]!.seq : row.snapshotSeq;
      return { updates, seq };
    } finally {
      sodium.sodium_memzero(dek);
    }
  },

  /** Grava um update e devolve o seq atribuído. Marca o doc como sujo. */
  append(docId: string, update: Uint8Array, authorUser: string): number {
    const dek = this.dekOf(docId);
    try {
      const blob = seal(update, dek, docId);
      const tx = sqlite.transaction(() => {
        const max = db.select({ seq: sql<number>`coalesce(max(${sheetUpdates.seq}), 0)` })
          .from(sheetUpdates).where(eq(sheetUpdates.docId, docId)).get();
        const seq = (max?.seq ?? 0) + 1;
        db.insert(sheetUpdates).values({
          docId, seq, blob, authorUser, createdAt: new Date().toISOString(),
        }).run();
        db.update(sheetDocs).set({ dirty: 1, updatedAt: new Date().toISOString() })
          .where(eq(sheetDocs.docId, docId)).run();
        return seq;
      });
      return tx();
    } finally {
      sodium.sodium_memzero(dek);
    }
  },

  /** Compacta: grava snapshot novo e descarta os updates já incorporados. */
  compact(docId: string, snapshot: Uint8Array, seq: number): void {
    const dek = this.dekOf(docId);
    try {
      const blob = seal(snapshot, dek, docId);
      const tx = sqlite.transaction(() => {
        db.update(sheetDocs).set({ snapshot: blob, snapshotSeq: seq, updatedAt: new Date().toISOString() })
          .where(eq(sheetDocs.docId, docId)).run();
        db.delete(sheetUpdates)
          .where(and(eq(sheetUpdates.docId, docId), sql`${sheetUpdates.seq} <= ${seq}`)).run();
      });
      tx();
    } finally {
      sodium.sodium_memzero(dek);
    }
  },

  countUpdates(docId: string): number {
    const r = db.select({ n: sql<number>`count(*)` }).from(sheetUpdates).where(eq(sheetUpdates.docId, docId)).get();
    return r?.n ?? 0;
  },

  /** Autores distintos desde o último snapshot — vai para a auditoria. */
  authorsSince(docId: string, seq: number): string[] {
    const rows = db.selectDistinct({ author: sheetUpdates.authorUser }).from(sheetUpdates)
      .where(and(eq(sheetUpdates.docId, docId), gt(sheetUpdates.seq, seq))).all();
    return rows.map((r) => r.author);
  },

  markClean(docId: string, fingerprint: string | null): void {
    db.update(sheetDocs).set({ dirty: 0, fingerprint, updatedAt: new Date().toISOString() })
      .where(eq(sheetDocs.docId, docId)).run();
  },

  remove(docId: string): void {
    const tx = sqlite.transaction(() => {
      db.delete(sheetUpdates).where(eq(sheetUpdates.docId, docId)).run();
      db.delete(sheetDocs).where(eq(sheetDocs.docId, docId)).run();
    });
    tx();
  },
};
