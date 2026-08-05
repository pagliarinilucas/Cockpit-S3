import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cockpit-zip-')), 'test.sqlite');
process.env.ACCESS_TOKEN_SECRET = 'x'.repeat(48);

const { storageRoutes } = await import('./routes');
const { zipTickets } = await import('./zip-tickets');

const BUCKET = 'conn-inexistente:fotos';
const url = (p: string) => `http://local/api${p}`;

describe('rotas do ZIP', () => {
  test('GET /zip não exige Bearer (o ticket é a credencial)', async () => {
    const res = await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip`)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_ticket' });
  });

  test('GET /zip com ticket inválido devolve 404', async () => {
    const res = await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip?ticket=naoexiste`)));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'bad_ticket' });
  });

  test('POST /zip-ticket exige autenticação', async () => {
    const res = await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip-ticket`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', prefix: 'docs/' }),
    }));
    expect(res.status).toBe(401);
  });

  test('ticket de outro bucket não serve', async () => {
    const ticket = zipTickets.create({
      bucketId: 'conn-inexistente:outro',
      owner: 'lucas',
      filename: 'x',
      entries: [{ key: 'a.txt', name: 'a.txt', size: 1 }],
    });
    const res = await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip?ticket=${ticket}`)));
    expect(res.status).toBe(404);
  });

  test('ticket válido streama um ZIP; objeto ilegível vira _FALHAS.txt', async () => {
    const ticket = zipTickets.create({
      bucketId: BUCKET,
      owner: 'lucas',
      filename: 'férias 2024',
      entries: [{ key: 'ferias/a.jpg', name: 'a.jpg', size: 10 }],
    });
    const res = await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip?ticket=${ticket}`)));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('férias 2024.zip')}`,
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(new TextDecoder().decode(bytes)).toContain('_FALHAS.txt');
  });

  test('o ticket é consumido: o segundo GET falha', async () => {
    const ticket = zipTickets.create({
      bucketId: BUCKET,
      owner: 'lucas',
      filename: 'x',
      entries: [{ key: 'a.txt', name: 'a.txt', size: 1 }],
    });
    expect((await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip?ticket=${ticket}`)))).status).toBe(200);
    expect((await storageRoutes.handle(new Request(url(`/buckets/${BUCKET}/zip?ticket=${ticket}`)))).status).toBe(404);
  });
});
