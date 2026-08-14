import { describe, expect, test } from 'bun:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { zipStream, type ZipEntry } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

function streamOf(data: Uint8Array, chunk = 8): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= data.length) { c.close(); return; }
      c.enqueue(data.slice(i, i + chunk));
      i += chunk;
    },
  });
}

function openFrom(files: Record<string, Uint8Array>) {
  return async (key: string) => {
    const d = files[key];
    if (!d) throw new Error('missing ' + key);
    return streamOf(d);
  };
}

async function collect(rs: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = rs.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    if (value) parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

interface ReadEntry {
  name: string; method: number; flags: number; versionNeeded: number;
  crc: number; csize: number; usize: number; offset: number;
  externalAttrs: number; hasZip64Extra: boolean;
  localVersionNeeded: number; localHasZip64Extra: boolean;
  data: Uint8Array;
}

interface ReadZip { entries: ReadEntry[]; zip64End: boolean }

function readZip(buf: Uint8Array): ReadZip {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD não encontrado');

  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  let zip64End = false;

  if (count === 0xffff || cdOffset === 0xffffffff || dv.getUint32(eocd + 12, true) === 0xffffffff) {
    const loc = eocd - 20;
    if (dv.getUint32(loc, true) !== 0x07064b50) throw new Error('locator zip64 ausente');
    const z64 = Number(dv.getBigUint64(loc + 8, true));
    if (dv.getUint32(z64, true) !== 0x06064b50) throw new Error('EOCD zip64 ausente');
    count = Number(dv.getBigUint64(z64 + 32, true));
    cdOffset = Number(dv.getBigUint64(z64 + 48, true));
    zip64End = true;
  }

  const entries: ReadEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('central directory corrompido em ' + p);
    const versionNeeded = dv.getUint16(p + 6, true);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    let csize = dv.getUint32(p + 20, true);
    let usize = dv.getUint32(p + 24, true);
    const namelen = dv.getUint16(p + 28, true);
    const extralen = dv.getUint16(p + 30, true);
    const externalAttrs = dv.getUint32(p + 38, true);
    let offset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.slice(p + 46, p + 46 + namelen));

    let hasZip64Extra = false;
    let x = p + 46 + namelen;
    const xEnd = x + extralen;
    while (x + 4 <= xEnd) {
      const id = dv.getUint16(x, true), size = dv.getUint16(x + 2, true);
      if (id === 0x0001) {
        hasZip64Extra = true;
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(dv.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + size;
    }

    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error('local header inválido: ' + name);
    const localVersionNeeded = dv.getUint16(offset + 4, true);
    const lnamelen = dv.getUint16(offset + 26, true);
    const lextralen = dv.getUint16(offset + 28, true);
    let localHasZip64Extra = false;
    let lx = offset + 30 + lnamelen;
    const lxEnd = lx + lextralen;
    while (lx + 4 <= lxEnd) {
      if (dv.getUint16(lx, true) === 0x0001) localHasZip64Extra = true;
      lx += 4 + dv.getUint16(lx + 2, true);
    }
    const start = offset + 30 + lnamelen + lextralen;
    const raw = buf.slice(start, start + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;

    entries.push({
      name, method, flags, versionNeeded, crc, csize, usize, offset, externalAttrs, hasZip64Extra,
      localVersionNeeded, localHasZip64Extra, data,
    });
    p = x;
  }
  return { entries, zip64End };
}

async function build(entries: ZipEntry[], files: Record<string, Uint8Array>): Promise<ReadZip> {
  return readZip(await collect(zipStream(entries, openFrom(files))));
}

const entry = (key: string, name: string, size: number, modified?: string): ZipEntry => ({ key, name, size, modified });

describe('zipStream', () => {
  test('roundtrip: conteúdo e CRC de cada entrada conferem', async () => {
    const files = {
      'p/a.txt': enc.encode('conteudo do a '.repeat(20)),
      'p/b.txt': enc.encode('outro conteudo b'),
    };
    const zip = await build([
      entry('p/a.txt', 'a.txt', files['p/a.txt']!.length),
      entry('p/b.txt', 'b.txt', files['p/b.txt']!.length),
    ], files);

    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    for (const e of zip.entries) {
      const original = files[('p/' + e.name) as keyof typeof files]!;
      expect(dec.decode(e.data)).toBe(dec.decode(original));
      expect(e.usize).toBe(original.length);
      expect(e.crc).toBe(crc32(Buffer.from(original)));
      expect(e.flags & 0x08).toBe(0x08);
      expect(e.flags & 0x800).toBe(0x800);
    }
  });

  test('pasta aninhada preserva o caminho no nome', async () => {
    const files = { 'p/sub/dir/x.txt': enc.encode('x') };
    const zip = await build([entry('p/sub/dir/x.txt', 'sub/dir/x.txt', 1)], files);
    expect(zip.entries[0]!.name).toBe('sub/dir/x.txt');
    expect(dec.decode(zip.entries[0]!.data)).toBe('x');
  });

  test('nome com acento sobrevive (UTF-8)', async () => {
    const files = { 'p/ação.txt': enc.encode('olá') };
    const zip = await build([entry('p/ação.txt', 'ação.txt', 4)], files);
    expect(zip.entries[0]!.name).toBe('ação.txt');
    expect(dec.decode(zip.entries[0]!.data)).toBe('olá');
  });

  test('extensão já comprimida sai stored; texto sai deflated', async () => {
    const body = enc.encode('a'.repeat(500));
    const files = { 'p/foto.jpg': body, 'p/doc.txt': body };
    const zip = await build([
      entry('p/foto.jpg', 'foto.jpg', body.length),
      entry('p/doc.txt', 'doc.txt', body.length),
    ], files);

    const jpg = zip.entries.find((e) => e.name === 'foto.jpg')!;
    const txt = zip.entries.find((e) => e.name === 'doc.txt')!;
    expect(jpg.method).toBe(0);
    expect(jpg.csize).toBe(body.length);
    expect(txt.method).toBe(8);
    expect(txt.csize).toBeLessThan(body.length);
    expect(dec.decode(txt.data)).toBe(dec.decode(body));
  });

  test('marcador de pasta vira entrada de diretório vazia', async () => {
    const zip = await build([entry('p/vazia/', 'vazia/', 0)], {});
    const dir = zip.entries[0]!;
    expect(dir.name).toBe('vazia/');
    expect(dir.usize).toBe(0);
    expect(dir.method).toBe(0);
    expect(dir.externalAttrs & 0x10).toBe(0x10);
    expect(zip.entries.some((e) => e.name === '_FALHAS.txt')).toBe(false);
  });

  test('Zip Slip: segmentos .. e barra invertida são saneados', async () => {
    const files = { 'p/evil': enc.encode('x'), 'p/back': enc.encode('y') };
    const zip = await build([
      entry('p/evil', '../../etc/passwd', 1),
      entry('p/back', 'sub\\win.txt', 1),
    ], files);
    const names = zip.entries.map((e) => e.name);
    expect(names).toContain('etc/passwd');
    expect(names).toContain('sub_win.txt');
    expect(names.some((n) => n.includes('..'))).toBe(false);
  });

  test('nome que zera após o saneamento é pulado e listado', async () => {
    const files = { 'p/a.txt': enc.encode('ok'), 'p/weird': enc.encode('x') };
    const zip = await build([
      entry('p/a.txt', 'a.txt', 2),
      entry('p/weird', '../..', 1),
    ], files);
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', '_FALHAS.txt']);
    expect(dec.decode(zip.entries[1]!.data)).toContain('p/weird');
  });

  test('open que rejeita: entrada pulada, _FALHAS.txt presente, zip válido', async () => {
    const files = { 'p/a.txt': enc.encode('ok') };
    const zip = await build([
      entry('p/a.txt', 'a.txt', 2),
      entry('p/sumiu.txt', 'sumiu.txt', 10),
    ], files);

    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', '_FALHAS.txt']);
    const falhas = dec.decode(zip.entries[1]!.data);
    expect(falhas).toContain('p/sumiu.txt');
    expect(dec.decode(zip.entries[0]!.data)).toBe('ok');
  });

  test('stream que quebra no meio: entrada truncada, listada, zip ainda legível', async () => {
    const good = enc.encode('bom');
    const open = async (key: string) => {
      if (key === 'p/good') return streamOf(good);
      return new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode('parcial')); },
        pull() { throw new Error('rede caiu'); },
      });
    };
    const zip = readZip(await collect(zipStream([
      entry('p/good', 'good.txt', 3),
      entry('p/bad', 'bad.txt', 999),
    ], open)));

    expect(zip.entries.map((e) => e.name)).toEqual(['good.txt', 'bad.txt', '_FALHAS.txt']);
    expect(dec.decode(zip.entries[0]!.data)).toBe('bom');
    const bad = zip.entries[1]!;
    expect(dec.decode(bad.data)).toBe('parcial');
    expect(bad.crc).toBe(crc32(Buffer.from('parcial')));
    expect(dec.decode(zip.entries[2]!.data)).toContain('p/bad');
  });

  test('todas as entradas falhando ainda produz zip válido só com _FALHAS.txt', async () => {
    const zip = await build([entry('p/x', 'x', 1), entry('p/y', 'y', 1)], {});
    expect(zip.entries.map((e) => e.name)).toEqual(['_FALHAS.txt']);
    const t = dec.decode(zip.entries[0]!.data);
    expect(t).toContain('p/x');
    expect(t).toContain('p/y');
  });

  test('ZIP64 por entrada quando o tamanho declarado passa de 4 GiB', async () => {
    const body = enc.encode('pequeno de verdade');
    const files = { 'p/big.bin': body, 'p/small.txt': body };
    const zip = await build([
      entry('p/big.bin', 'big.bin', 5 * 1024 ** 3),
      entry('p/small.txt', 'small.txt', body.length),
    ], files);

    const big = zip.entries.find((e) => e.name === 'big.bin')!;
    const small = zip.entries.find((e) => e.name === 'small.txt')!;
    expect(big.localVersionNeeded).toBe(45);
    expect(big.localHasZip64Extra).toBe(true);
    expect(big.versionNeeded).toBe(45);
    expect(big.usize).toBe(body.length);
    expect(dec.decode(big.data)).toBe(dec.decode(body));
    expect(small.localVersionNeeded).toBe(20);
    expect(small.localHasZip64Extra).toBe(false);
    expect(small.versionNeeded).toBe(20);
    expect(zip.entries.some((e) => e.name === '_FALHAS.txt')).toBe(false);
  });

  test('data/hora DOS vem do modified; sem modified usa 1980', async () => {
    const files = { 'p/a.txt': enc.encode('a'), 'p/b.txt': enc.encode('b') };
    const bytes = await collect(zipStream([
      entry('p/a.txt', 'a.txt', 1, '2024-03-15T10:20:30.000Z'),
      entry('p/b.txt', 'b.txt', 1),
    ], openFrom(files)));
    const zip = readZip(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dateOf = (e: ReadEntry) => dv.getUint16(e.offset + 12, true);
    const a = zip.entries.find((e) => e.name === 'a.txt')!;
    const b = zip.entries.find((e) => e.name === 'b.txt')!;
    expect(dateOf(a) >> 9).toBe(2024 - 1980);
    expect((dateOf(a) >> 5) & 0xf).toBe(3);
    expect(dateOf(a) & 0x1f).toBe(15);
    expect(dateOf(b) >> 9).toBe(0);
  });

  test('ZIP64 no fim com mais de 65535 entradas', async () => {
    const entries: ZipEntry[] = [];
    for (let i = 0; i < 65600; i++) entries.push(entry(`p/e${i}/`, `e${i}/`, 0));
    const zip = await build(entries, {});
    expect(zip.zip64End).toBe(true);
    expect(zip.entries.length).toBe(65600);
    expect(zip.entries[65599]!.name).toBe('e65599/');
  }, 60_000);
});
