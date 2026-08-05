export interface ZipEntry {
  key: string;
  name: string;
  size: number;
  modified?: string;
}

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;

const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const VERSION_BASE = 20;
const VERSION_ZIP64 = 45;
const VERSION_MADE_BY = (3 << 8) | VERSION_ZIP64;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

const ATTRS_FILE = 0o100644 << 16;
const ATTRS_DIR = (0o40755 << 16) | 0x10;

const FAILURES_NAME = '_FALHAS.txt';

const ALREADY_COMPRESSED = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v',
  'mp3', 'aac', 'ogg', 'oga', 'opus', 'flac', 'm4a',
  'zip', 'rar', '7z', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'br',
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

class ByteWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(value: number): void { this.view.setUint16(this.at, value, true); this.at += 2; }
  u32(value: number): void { this.view.setUint32(this.at, value, true); this.at += 4; }
  u64(value: number): void { this.view.setBigUint64(this.at, BigInt(value), true); this.at += 8; }
  raw(value: Uint8Array): void { this.bytes.set(value, this.at); this.at += value.length; }
  done(): Uint8Array { return this.bytes; }
}

function sanitizeName(name: string): string {
  const isDir = name.endsWith('/');
  const parts = name.replace(/\\/g, '_').split('/').filter((p) => p && p !== '.' && p !== '..');
  const joined = parts.join('/');
  if (!joined) return '';
  return isDir ? joined + '/' : joined;
}

function dosDateTime(modified?: string): { time: number; date: number } {
  const when = modified ? new Date(modified) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getUTCFullYear() < 1980) {
    return { time: 0, date: (1 << 5) | 1 };
  }
  return {
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
    date: ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
  };
}

function methodFor(name: string): number {
  const ext = name.toLowerCase().split('/').pop()!.split('.').pop() ?? '';
  return ALREADY_COMPRESSED.has(ext) ? METHOD_STORED : METHOD_DEFLATE;
}

function localHeader(name: Uint8Array, method: number, time: number, date: number, zip64: boolean): Uint8Array {
  const extraLen = zip64 ? 20 : 0;
  const w = new ByteWriter(30 + name.length + extraLen);
  w.u32(SIG_LOCAL);
  w.u16(zip64 ? VERSION_ZIP64 : VERSION_BASE);
  w.u16(FLAG_DESCRIPTOR | FLAG_UTF8);
  w.u16(method);
  w.u16(time);
  w.u16(date);
  w.u32(0);
  w.u32(0);
  w.u32(0);
  w.u16(name.length);
  w.u16(extraLen);
  w.raw(name);
  if (zip64) { w.u16(0x0001); w.u16(16); w.u64(0); w.u64(0); }
  return w.done();
}

function dataDescriptor(crc: number, csize: number, usize: number, zip64: boolean): Uint8Array {
  const w = new ByteWriter(zip64 ? 24 : 16);
  w.u32(SIG_DESCRIPTOR);
  w.u32(crc);
  if (zip64) { w.u64(csize); w.u64(usize); } else { w.u32(csize); w.u32(usize); }
  return w.done();
}

interface CentralRecord {
  name: Uint8Array;
  method: number;
  time: number;
  date: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  zip64: boolean;
  isDir: boolean;
}

function centralEntry(r: CentralRecord): Uint8Array {
  const bigUsize = r.usize >= U32_MAX;
  const bigCsize = r.csize >= U32_MAX;
  const bigOffset = r.offset >= U32_MAX;
  const extraFields = (bigUsize ? 1 : 0) + (bigCsize ? 1 : 0) + (bigOffset ? 1 : 0);
  const extraLen = extraFields ? 4 + extraFields * 8 : 0;

  const w = new ByteWriter(46 + r.name.length + extraLen);
  w.u32(SIG_CENTRAL);
  w.u16(VERSION_MADE_BY);
  w.u16(r.zip64 ? VERSION_ZIP64 : VERSION_BASE);
  w.u16(FLAG_DESCRIPTOR | FLAG_UTF8);
  w.u16(r.method);
  w.u16(r.time);
  w.u16(r.date);
  w.u32(r.crc);
  w.u32(bigCsize ? U32_MAX : r.csize);
  w.u32(bigUsize ? U32_MAX : r.usize);
  w.u16(r.name.length);
  w.u16(extraLen);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u32(r.isDir ? ATTRS_DIR : ATTRS_FILE);
  w.u32(bigOffset ? U32_MAX : r.offset);
  w.raw(r.name);
  if (extraLen) {
    w.u16(0x0001);
    w.u16(extraFields * 8);
    if (bigUsize) w.u64(r.usize);
    if (bigCsize) w.u64(r.csize);
    if (bigOffset) w.u64(r.offset);
  }
  return w.done();
}

function endRecords(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const zip64 = count > U16_MAX || cdSize >= U32_MAX || cdOffset >= U32_MAX;
  const w = new ByteWriter((zip64 ? 56 + 20 : 0) + 22);
  if (zip64) {
    w.u32(SIG_EOCD64);
    w.u64(44);
    w.u16(VERSION_MADE_BY);
    w.u16(VERSION_ZIP64);
    w.u32(0);
    w.u32(0);
    w.u64(count);
    w.u64(count);
    w.u64(cdSize);
    w.u64(cdOffset);
    w.u32(SIG_LOCATOR64);
    w.u32(0);
    w.u64(cdOffset + cdSize);
    w.u32(1);
  }
  w.u32(SIG_EOCD);
  w.u16(0);
  w.u16(0);
  w.u16(Math.min(count, U16_MAX));
  w.u16(Math.min(count, U16_MAX));
  w.u32(Math.min(cdSize, U32_MAX));
  w.u32(Math.min(cdOffset, U32_MAX));
  w.u16(0);
  return w.done();
}

function reason(err: unknown): string {
  return String((err as Error)?.message || err).slice(0, 200);
}

function streamOfBytes(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(data); c.close(); } });
}

async function* deflated(
  source: ReadableStream<Uint8Array>,
  onRaw: (chunk: Uint8Array) => void,
): AsyncGenerator<Uint8Array> {
  const compressor = new CompressionStream('deflate-raw');
  const writer = compressor.writable.getWriter();
  const pump = (async () => {
    const reader = source.getReader() as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) { onRaw(value); await writer.write(value); }
      }
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  const reader = compressor.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) yield value;
  }
  await pump;
}

async function* stored(
  source: ReadableStream<Uint8Array>,
  onRaw: (chunk: Uint8Array) => void,
): AsyncGenerator<Uint8Array> {
  const reader = source.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { onRaw(value); yield value; }
  }
}

interface WriteState { offset: number; central: CentralRecord[]; failures: string[] }

async function* writeEntry(
  state: WriteState,
  entry: { key: string; name: string; size: number; modified?: string },
  source: ReadableStream<Uint8Array> | null,
): AsyncGenerator<Uint8Array> {
  const name = new TextEncoder().encode(entry.name);
  const isDir = entry.name.endsWith('/');
  const method = isDir ? METHOD_STORED : methodFor(entry.name);
  const zip64 = entry.size >= U32_MAX || state.offset >= U32_MAX;
  const { time, date } = dosDateTime(entry.modified);
  const offset = state.offset;

  const header = localHeader(name, method, time, date, zip64);
  state.offset += header.length;
  yield header;

  let crc = 0xffffffff;
  let usize = 0;
  let csize = 0;
  const onRaw = (chunk: Uint8Array) => { crc = crcUpdate(crc, chunk); usize += chunk.length; };

  if (source) {
    const body = method === METHOD_DEFLATE ? deflated(source, onRaw) : stored(source, onRaw);
    try {
      for await (const chunk of body) { csize += chunk.length; state.offset += chunk.length; yield chunk; }
    } catch (err) {
      state.failures.push(`${entry.key}: interrompido — ${reason(err)}`);
    }
  }

  if (!zip64 && (usize > U32_MAX || csize > U32_MAX)) {
    state.failures.push(`${entry.key}: tamanho real acima de 4 GiB divergiu da listagem — entrada pode extrair incompleta`);
  }

  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  const descriptor = dataDescriptor(finalCrc, csize, usize, zip64);
  state.offset += descriptor.length;
  yield descriptor;

  state.central.push({ name, method, time, date, crc: finalCrc, csize, usize, offset, zip64, isDir });
}

async function* generate(
  entries: ZipEntry[],
  open: (key: string) => Promise<ReadableStream<Uint8Array>>,
): AsyncGenerator<Uint8Array> {
  const state: WriteState = { offset: 0, central: [], failures: [] };

  for (const entry of entries) {
    const name = sanitizeName(entry.name);
    if (!name) { state.failures.push(`${entry.key}: nome inválido dentro do ZIP`); continue; }

    const isDir = name.endsWith('/');
    let source: ReadableStream<Uint8Array> | null = null;
    if (!isDir) {
      try { source = await open(entry.key); }
      catch (err) { state.failures.push(`${entry.key}: ${reason(err)}`); continue; }
    }
    yield* writeEntry(state, { ...entry, name }, source);
  }

  if (state.failures.length) {
    const text = new TextEncoder().encode(
      `Estas entradas não entraram completas no ZIP:\n\n${state.failures.join('\n')}\n`,
    );
    yield* writeEntry(
      state,
      { key: FAILURES_NAME, name: FAILURES_NAME, size: text.length },
      streamOfBytes(text),
    );
  }

  const cdOffset = state.offset;
  let cdSize = 0;
  for (const record of state.central) {
    const bytes = centralEntry(record);
    cdSize += bytes.length;
    yield bytes;
  }
  yield endRecords(state.central.length, cdSize, cdOffset);
}

export function zipStream(
  entries: ZipEntry[],
  open: (key: string) => Promise<ReadableStream<Uint8Array>>,
): ReadableStream<Uint8Array> {
  const iterator = generate(entries, open);
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() { await iterator.return?.(undefined); },
  });
}
