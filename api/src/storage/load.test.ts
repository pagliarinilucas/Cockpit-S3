// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

// Teste de carga: precisa de um S3 real (MinIO/Garage). Sem ele, é pulado.
const d = process.env.S3_TEST_ENDPOINT ? describe : describe.skip;

const MiB = 1024 * 1024;
const rssMB = () => process.memoryUsage().rss / MiB;
const CAP = Number(process.env.RSS_CAP_MB ?? 900); // teto configurável (evita flakiness)

const CID = 'loadcid';
const BUCKET = process.env.S3_TEST_BUCKET || 'loadtest';
const BUCKET_ID = `${CID}:${BUCKET}`;

const DB = join(tmpdir(), `cockpit-load-${crypto.randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
process.env.COCKPIT_KEK = Buffer.alloc(32, 7).toString('base64');

d('carga: 256 MiB com RSS estável', () => {
  it('upload+download não estoura o teto de RSS', async () => {
    await import('../db');
    const { initFileKekProvider } = await import('../crypto/kek');
    initFileKekProvider();

    const { s3 } = await import('./s3');
    s3.configureSource(CID, {
      endpoint: process.env.S3_TEST_ENDPOINT!,
      region: process.env.S3_TEST_REGION || 'us-east-1',
      accessKey: process.env.S3_TEST_KEY!,
      secretKey: process.env.S3_TEST_SECRET!,
    });

    // Cria o bucket de teste diretamente (sem passar pelo connectionsStore/HTTP).
    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    const cl = new S3Client({
      endpoint: process.env.S3_TEST_ENDPOINT!,
      region: process.env.S3_TEST_REGION || 'us-east-1',
      credentials: { accessKeyId: process.env.S3_TEST_KEY!, secretAccessKey: process.env.S3_TEST_SECRET! },
      forcePathStyle: true,
    });
    try {
      await cl.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (e) {
      const code = (e as { Code?: string; name?: string }).Code ?? (e as { name?: string }).name;
      if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw e;
    }

    const { uploadEncrypted, downloadEncrypted } = await import('./crypto-pipeline');
    const { objectsStore } = await import('../objects/store');

    const SIZE = 256 * MiB;
    const BLOCK = 256 * 1024;
    let peak = rssMB();

    // Stream de plaintext gerado em blocos pequenos (nunca aloca os 256 MiB inteiros).
    let sent = 0;
    const src = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= SIZE) { ctrl.close(); return; }
        const n = Math.min(BLOCK, SIZE - sent);
        sent += n;
        ctrl.enqueue(new Uint8Array(n));
        const r = rssMB();
        if (r > peak) peak = r;
      },
    });

    await uploadEncrypted({
      cid: CID, bucket: BUCKET, bucketId: BUCKET_ID, key: 'load.bin',
      sizePlain: SIZE, contentType: 'application/octet-stream', body: src,
    });

    const row = objectsStore.get(BUCKET_ID, 'load.bin')!;
    const stream = await downloadEncrypted(row, CID, BUCKET);
    const rd = stream.getReader();
    let outLen = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      outLen += value.byteLength;
      const r = rssMB();
      if (r > peak) peak = r;
    }

    // eslint-disable-next-line no-console
    console.log(`[load.test] peak RSS = ${Math.round(peak)} MiB (cap = ${CAP} MiB)`);
    expect(outLen).toBe(SIZE);
    expect(peak).toBeLessThan(CAP);
  }, 120_000);
});

afterAll(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
});
