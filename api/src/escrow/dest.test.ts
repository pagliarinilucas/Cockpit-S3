// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, test, expect } from 'bun:test';
import { s3Dest, type DestConfig } from './dest';

const RUN = !!process.env.ESCROW_TEST_ENDPOINT;

describe.skipIf(!RUN)('s3Dest (integração)', () => {
  const cfg: DestConfig = {
    endpoint: process.env.ESCROW_TEST_ENDPOINT || '',
    region: process.env.ESCROW_TEST_REGION || 'garage',
    accessKey: process.env.ESCROW_TEST_KEY || '',
    secretKey: process.env.ESCROW_TEST_SECRET || '',
    bucket: process.env.ESCROW_TEST_BUCKET || '',
    prefix: `escrow-test-${process.pid}/`,
  };

  test('put -> list -> get -> del', async () => {
    const dest = s3Dest(cfg);
    const key = `obj-${Date.now()}.bin`;
    const body = Buffer.from('conteudo de teste do escrow dest');

    await dest.put(key, body);

    const listed = await dest.list();
    const found = listed.find((it) => it.key === key);
    expect(found).toBeDefined();
    expect(found!.size).toBe(body.length);
    expect(typeof found!.at).toBe('number');

    const got = await dest.get(key);
    expect(Buffer.compare(got, body)).toBe(0);

    await dest.del([key]);

    const listedAfter = await dest.list();
    expect(listedAfter.find((it) => it.key === key)).toBeUndefined();
  });

  test('test() valida credenciais com put+del de sonda', async () => {
    const dest = s3Dest(cfg);
    await expect(dest.test()).resolves.toBeUndefined();
  });
});
