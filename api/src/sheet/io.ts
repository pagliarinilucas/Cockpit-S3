// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Implementação real do SheetIo: liga a sessão ao S3, passando pelo pipeline
 * cifrado quando o bucket tem criptografia. É a única parte do editor que sabe
 * de S3, o que mantém session/materialize testáveis sem rede.
 */
import { s3 } from '../storage/s3';
import { objectsStore, bucketCryptoStore } from '../objects/store';
import { downloadEncrypted, uploadEncrypted } from '../storage/crypto-pipeline';
import { isCluster, ensureClusterBucketAccess } from '../clusters/access';
import { audit } from '../audit/store';
import type { SheetIo } from './materialize';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function parseBucketId(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

export function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'tsv') return 'text/tab-separated-values';
  return XLSX_MIME;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

export function makeSheetIo(): SheetIo {
  return {
    async fetchBytes(bucketId, key) {
      const ref = parseBucketId(bucketId);
      if (!ref) throw new Error('bad_bucket_id');
      if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
      const row = objectsStore.get(bucketId, key);
      if (row) return readAll(await downloadEncrypted(row, ref.cid, ref.bucket));
      return s3.bytes(ref.cid, ref.bucket, key);
    },

    /**
     * Identidade do conteúdo atual. Para objeto cifrado, o blob real é o s3Key
     * opaco — o ETag dele muda a cada regravação, que é o que precisamos detectar.
     */
    async fingerprint(bucketId, key) {
      const ref = parseBucketId(bucketId);
      if (!ref) throw new Error('bad_bucket_id');
      const row = objectsStore.get(bucketId, key);
      try {
        const head = await s3.head(ref.cid, ref.bucket, row ? row.s3Key : key);
        return head.etag ?? `${head.size}:${head.modified ?? ''}`;
      } catch {
        return null;
      }
    },

    async writeBytes(bucketId, key, bytes, user) {
      const ref = parseBucketId(bucketId);
      if (!ref) throw new Error('bad_bucket_id');
      if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
      const contentType = contentTypeFor(key);

      if (objectsStore.get(bucketId, key) || bucketCryptoStore.isEnabled(bucketId)) {
        await uploadEncrypted({
          cid: ref.cid, bucket: ref.bucket, bucketId, key,
          sizePlain: bytes.byteLength, contentType,
          body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
        });
      } else {
        await s3.put(ref.cid, ref.bucket, key, bytes, contentType);
      }
      audit.log('upload', user, bucketId, key);
    },
  };
}
