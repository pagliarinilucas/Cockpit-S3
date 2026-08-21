// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Persistência do documento vivo. Com KEK configurada, todo blob de estado
 * (snapshot e updates) vai cifrado no banco com uma DEK por documento,
 * envelopada com a KEK — o mesmo envelope dos objetos.
 *
 * Sem KEK configurada, o rascunho é gravado em claro. A alternativa era exigir
 * criptografia para editar qualquer planilha, e isso deixava o editor
 * indisponível numa instalação sem criptografia — inclusive para um arquivo que
 * já está em texto claro no S3. Cifrar o rascunho de um arquivo que qualquer um
 * baixa em claro protegia nada e custava a funcionalidade inteira.
 *
 * Sem KEK nenhum bucket pode estar cifrado (envelopar DEK exige a KEK), então
 * este caminho nunca grava em claro o conteúdo de um arquivo cifrado. Quem
 * confere isso é `assertCanOpen`, chamado antes de abrir a sessão.
 *
 * `kekVersion = 0` marca a linha como não cifrada; versão de KEK real começa
 * em 1.
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

export const PLAINTEXT_KEK_VERSION = 0;

const EMPTY_DEK = Buffer.alloc(0);

/**
 * Como ler e escrever os blobs deste documento. Com DEK, cifra; sem DEK (linha
 * gravada sem KEK), passa direto. Quem usa chama `dispose` para zerar a chave.
 */
interface Cipher {
  seal(plain: Uint8Array): Buffer;
  open(blob: Buffer): Uint8Array;
  dispose(): void;
}

function cipherOf(docId: string, kekVersion: number, dekWrapped: Buffer): Cipher {
  if (kekVersion === PLAINTEXT_KEK_VERSION) {
    return {
      seal: (plain) => Buffer.from(plain),
      open: (blob) => new Uint8Array(blob),
      dispose: () => { /* não há chave para zerar */ },
    };
  }
  const kek = getKekProvider();
  if (!kek) throw new Error('sealed');
  const dek = kek.unwrapDek(DEFAULT_ORG, kekVersion, dekWrapped);
  return {
    seal: (plain) => seal(plain, dek, docId),
    open: (blob) => open(blob, dek, docId),
    dispose: () => sodium.sodium_memzero(dek),
  };
}

function cipherFor(docId: string): Cipher {
  const row = db.select({ dekWrapped: sheetDocs.dekWrapped, kekVersion: sheetDocs.kekVersion })
    .from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
  if (!row) throw new Error('doc_inexistente');
  return cipherOf(docId, row.kekVersion, row.dekWrapped as Buffer);
}

export const sheetStore = {
  find(docId: string): DocRow | null {
    const r = db.select({
      docId: sheetDocs.docId, bucketId: sheetDocs.bucketId, key: sheetDocs.key,
      fingerprint: sheetDocs.fingerprint, snapshotSeq: sheetDocs.snapshotSeq, dirty: sheetDocs.dirty,
    }).from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    return r ?? null;
  },

  /** Cria o doc com o snapshot inicial. Sem KEK, o rascunho fica em claro. */
  create(a: { docId: string; bucketId: string; key: string; fingerprint: string | null; snapshot: Uint8Array }): void {
    const kek = getKekProvider();
    const dek = kek ? generateDek() : EMPTY_DEK;
    const envelope = kek
      ? kek.wrapWithCurrent(DEFAULT_ORG, dek)
      : { wrapped: EMPTY_DEK, version: PLAINTEXT_KEK_VERSION };

    db.insert(sheetDocs).values({
      docId: a.docId, bucketId: a.bucketId, key: a.key, fingerprint: a.fingerprint,
      dekWrapped: envelope.wrapped, kekVersion: envelope.version,
      snapshot: kek ? seal(a.snapshot, dek, a.docId) : Buffer.from(a.snapshot),
      snapshotSeq: 0, dirty: 0,
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing().run();

    if (kek) sodium.sodium_memzero(dek);
  },

  /** O rascunho deste documento está cifrado no banco? */
  isSealed(docId: string): boolean {
    const row = db.select({ kekVersion: sheetDocs.kekVersion })
      .from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    return row ? row.kekVersion !== PLAINTEXT_KEK_VERSION : false;
  },

  /** Snapshot + updates posteriores, em ordem, já decifrados. */
  load(docId: string): { updates: Uint8Array[]; seq: number } | null {
    const row = db.select({
      snapshot: sheetDocs.snapshot, snapshotSeq: sheetDocs.snapshotSeq,
      dekWrapped: sheetDocs.dekWrapped, kekVersion: sheetDocs.kekVersion,
    }).from(sheetDocs).where(eq(sheetDocs.docId, docId)).get();
    if (!row) return null;

    const cipher = cipherOf(docId, row.kekVersion, row.dekWrapped as Buffer);
    try {
      const updates = [cipher.open(row.snapshot as Buffer)];
      const rows = db.select({ seq: sheetUpdates.seq, blob: sheetUpdates.blob })
        .from(sheetUpdates)
        .where(and(eq(sheetUpdates.docId, docId), gt(sheetUpdates.seq, row.snapshotSeq)))
        .orderBy(asc(sheetUpdates.seq)).all();
      for (const u of rows) updates.push(cipher.open(u.blob as Buffer));
      const seq = rows.length ? rows[rows.length - 1]!.seq : row.snapshotSeq;
      return { updates, seq };
    } finally {
      cipher.dispose();
    }
  },

  /** Grava um update e devolve o seq atribuído. Marca o doc como sujo. */
  append(docId: string, update: Uint8Array, authorUser: string): number {
    const cipher = cipherFor(docId);
    try {
      const blob = cipher.seal(update);
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
      cipher.dispose();
    }
  },

  /** Compacta: grava snapshot novo e descarta os updates já incorporados. */
  compact(docId: string, snapshot: Uint8Array, seq: number): void {
    const cipher = cipherFor(docId);
    try {
      const blob = cipher.seal(snapshot);
      const tx = sqlite.transaction(() => {
        db.update(sheetDocs).set({ snapshot: blob, snapshotSeq: seq, updatedAt: new Date().toISOString() })
          .where(eq(sheetDocs.docId, docId)).run();
        db.delete(sheetUpdates)
          .where(and(eq(sheetUpdates.docId, docId), sql`${sheetUpdates.seq} <= ${seq}`)).run();
      });
      tx();
    } finally {
      cipher.dispose();
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
