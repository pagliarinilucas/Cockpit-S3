// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';

// Este teste requer um S3 real (MinIO/Garage). Sem ele, é pulado.
const ENDPOINT = process.env.S3_TEST_ENDPOINT;
const d = ENDPOINT ? describe : describe.skip;

const DB = join(tmpdir(), `cockpit-pipe-${crypto.randomUUID()}.sqlite`);
const KEKFILE = join(tmpdir(), `cockpit-pipe-${crypto.randomUUID()}.key`);
process.env.DB_PATH = DB;
writeFileSync(KEKFILE, Buffer.alloc(32, 5).toString('base64'));
process.env.COCKPIT_KEK_FILE = KEKFILE;

d('pipeline cifrado (S3 real)', () => {
  // Setup do cid/bucket depende de como o teste registra uma conexão apontando
  // para S3_TEST_ENDPOINT com S3_TEST_KEY/S3_TEST_SECRET/S3_TEST_BUCKET.
  // (Detalhes de wiring conforme connectionsStore; ver README de teste.)
  it('roundtrip byte-exato via S3 real', async () => {
    await import('../db');
    const { initFileKekProvider } = await import('../crypto/kek');
    initFileKekProvider();
    const { uploadEncrypted, downloadEncrypted } = await import('./crypto-pipeline');
    const { objectsStore } = await import('../objects/store');
    // ... registrar conexão de teste; obter cid, bucket, bucketId ...
    const cid = process.env.S3_TEST_CID!;
    const bucket = process.env.S3_TEST_BUCKET!;
    const bucketId = `${cid}:${bucket}`;

    const plain = Buffer.alloc(300 * 1024 + 123, 42);
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(plain)); c.close(); },
    });
    await uploadEncrypted({ cid, bucket, bucketId, key: 'x/y.bin', sizePlain: plain.length, contentType: 'application/octet-stream', body });

    const row = objectsStore.get(bucketId, 'x/y.bin')!;
    expect(row.s3Key).not.toBe('x/y.bin');
    const out = downloadEncrypted(row, cid, bucket);
    const chunks: Buffer[] = [];
    const rd = (await out).getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(Buffer.from(value)); }
    expect(Buffer.concat(chunks).equals(plain)).toBe(true);
  });
});

afterAll(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
  rmSync(KEKFILE, { force: true });
});
