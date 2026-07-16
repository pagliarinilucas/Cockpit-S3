// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { encryptStream, decryptStream } from './stream';
import { generateDek } from './index';
import { cipherBlobSize, CHUNK_SIZE, ABYTES } from './constants';

async function pump(input: Uint8Array, ts: TransformStream<Uint8Array, Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const readAll = (async () => {
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  })();
  readAll.catch(() => {}); // marca como "handled" já de cara p/ evitar falso unhandledRejection no bun:test
  // escreve em pedaços de 300 KiB p/ exercitar o buffer parcial
  for (let i = 0; i < input.length; i += 300 * 1024) await writer.write(input.subarray(i, i + 300 * 1024));
  await writer.close();
  await readAll;
  return Buffer.concat(chunks);
}

function roundtrip(size: number) {
  return async () => {
    const dek = generateDek();
    const plain = Buffer.alloc(size);
    for (let i = 0; i < size; i++) plain[i] = i & 0xff;
    const { header, transform } = encryptStream(dek);
    const cipher = await pump(plain, transform);
    expect(cipher.length).toBe(cipherBlobSize(size)); // fórmula exata
    const out = await pump(cipher, decryptStream(dek, header));
    expect(out.equals(plain)).toBe(true);
  };
}

describe('encrypt/decrypt stream', () => {
  it('roundtrip 0 bytes', roundtrip(0));
  it('roundtrip < 1 chunk', roundtrip(1234));
  it('roundtrip múltiplo exato (2 chunks)', roundtrip(2 * CHUNK_SIZE));
  it('roundtrip N chunks + resto', roundtrip(2 * CHUNK_SIZE + 777));

  it('corrupção de 1 byte falha', async () => {
    const dek = generateDek();
    const { header, transform } = encryptStream(dek);
    const cipher = await pump(Buffer.alloc(5000, 7), transform);
    cipher[10]! ^= 0x01;
    await expect(pump(cipher, decryptStream(dek, header))).rejects.toBeDefined();
  });

  it('truncar o último chunk (perde TAG_FINAL) falha', async () => {
    const dek = generateDek();
    const { header, transform } = encryptStream(dek);
    const cipher = await pump(Buffer.alloc(5000, 7), transform);
    await expect(pump(cipher.subarray(0, cipher.length - 1), decryptStream(dek, header))).rejects.toBeDefined();
  });

  it('remoção do chunk final inteiro (blob truncado) falha', async () => {
    const dek = generateDek();
    const { header, transform } = encryptStream(dek);
    const lastPlainLen = 500;
    const size = CHUNK_SIZE + lastPlainLen; // 2 chunks: 1 cheio + 1 resto
    const cipher = await pump(Buffer.alloc(size, 7), transform);
    const lastChunkLen = lastPlainLen + ABYTES;
    const truncated = cipher.subarray(0, cipher.length - lastChunkLen);
    await expect(pump(truncated, decryptStream(dek, header))).rejects.toBeDefined();
  });

  it('DEK errada falha', async () => {
    const { header, transform } = encryptStream(generateDek());
    const cipher = await pump(Buffer.alloc(5000, 7), transform);
    await expect(pump(cipher, decryptStream(generateDek(), header))).rejects.toBeDefined();
  });
});
