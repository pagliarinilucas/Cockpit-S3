import {
  S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand,
  PutObjectCommand, GetObjectCommand, CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ConnFull } from '../connections/store';

export interface S3Item {
  kind: 'file' | 'folder';
  name: string;
  key: string;
  size?: number;
  modified?: string;
}

export interface S3Conn {
  endpoint: string; region: string; accessKey: string; secretKey: string; buckets?: string[];
}

const clients = new Map<string, S3Client>();   // connectionId -> client
const metas = new Map<string, { region: string; buckets: string[] }>();

export function isValidConfig(c: Partial<S3Conn> | null | undefined): c is S3Conn {
  return !!(c && c.endpoint && c.accessKey && c.secretKey);
}

function make(c: S3Conn): S3Client {
  return new S3Client({
    endpoint: c.endpoint,
    region: c.region || 'garage',
    credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey },
    forcePathStyle: true, // Garage requires path-style
  });
}

function client(cid: string): S3Client {
  const c = clients.get(cid);
  if (!c) throw new Error('connection_not_found');
  return c;
}

const INLINE = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif',
  'mp4', 'webm', 'ogv', 'mov', 'm4v',
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac',
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv',
  'json', 'xml', 'yml', 'yaml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'sh', 'ini', 'conf', 'env',
]);

// ext -> MIME, so we can override the response Content-Type on inline previews.
// Garage often stores objects as application/octet-stream, which makes the browser
// download (even inside an <iframe>) instead of rendering. Forcing the right type fixes it.
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  markdown: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8', tsv: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8', xml: 'text/xml; charset=utf-8',
  yml: 'text/plain; charset=utf-8', yaml: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8',
  css: 'text/plain; charset=utf-8', js: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8', tsx: 'text/plain; charset=utf-8',
  jsx: 'text/plain; charset=utf-8', sh: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8', conf: 'text/plain; charset=utf-8', env: 'text/plain; charset=utf-8',
};

async function listBuckets(cl: S3Client): Promise<string[]> {
  const res = await cl.send(new ListBucketsCommand({}));
  return (res.Buckets ?? []).map((b) => b.Name!).filter(Boolean);
}

export const s3 = {
  /** Rebuild the whole registry from the connection list (boot + on change). */
  configureAll(conns: ConnFull[]): void {
    clients.clear(); metas.clear();
    for (const c of conns) {
      if (!isValidConfig(c)) continue;
      clients.set(c.id, make(c));
      metas.set(c.id, { region: c.region || 'garage', buckets: c.buckets ?? [] });
    }
  },
  configureOne(c: ConnFull): void {
    if (!isValidConfig(c)) return;
    clients.set(c.id, make(c));
    metas.set(c.id, { region: c.region || 'garage', buckets: c.buckets ?? [] });
  },
  removeOne(cid: string): void { clients.delete(cid); metas.delete(cid); },

  hasAny(): boolean { return clients.size > 0; },
  has(cid: string): boolean { return clients.has(cid); },
  region(cid: string): string { return metas.get(cid)?.region || 'garage'; },

  /** Try a config without registering it. Returns bucket names. */
  async test(c: S3Conn): Promise<string[]> {
    return listBuckets(make(c));
  },

  async bucketNames(cid: string): Promise<string[]> {
    const m = metas.get(cid);
    if (m?.buckets.length) return m.buckets;
    return listBuckets(client(cid));
  },

  async createBucket(cid: string, name: string): Promise<void> {
    await client(cid).send(new CreateBucketCommand({ Bucket: name }));
  },

  async list(cid: string, bucket: string, prefix: string, opts: { token?: string; limit?: number } = {}): Promise<{ items: S3Item[]; nextToken?: string }> {
    const res = await client(cid).send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, Delimiter: '/',
      ContinuationToken: opts.token, MaxKeys: Math.min(1000, Math.max(1, opts.limit ?? 200)),
    }));
    const items: S3Item[] = [];
    for (const cp of res.CommonPrefixes ?? []) {
      if (!cp.Prefix) continue;
      items.push({ kind: 'folder', name: cp.Prefix.slice(prefix.length).replace(/\/$/, ''), key: cp.Prefix });
    }
    for (const o of res.Contents ?? []) {
      if (!o.Key || o.Key === prefix) continue;
      const name = o.Key.slice(prefix.length);
      if (!name) continue;
      items.push({ kind: 'file', name, key: o.Key, size: o.Size, modified: o.LastModified?.toISOString() });
    }
    items.sort((a, b) => a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name));
    return { items, nextToken: res.IsTruncated ? res.NextContinuationToken : undefined };
  },

  async presign(cid: string, bucket: string, key: string, mode: 'download' | 'preview'): Promise<{ url: string; disposition: 'inline' | 'attachment' }> {
    const ext = (key.toLowerCase().split('.').pop() || '');
    const disposition: 'inline' | 'attachment' = mode === 'preview' && INLINE.has(ext) ? 'inline' : 'attachment';
    const filename = key.split('/').pop() || 'file';
    const cmd = new GetObjectCommand({
      Bucket: bucket, Key: key,
      ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // On inline previews, override the stored Content-Type (often octet-stream in
      // Garage) so the browser renders the PDF/image/etc. instead of downloading it.
      ...(disposition === 'inline' && MIME[ext] ? { ResponseContentType: MIME[ext] } : {}),
    });
    const url = await getSignedUrl(client(cid), cmd, { expiresIn: 300 });
    return { url, disposition };
  },

  /**
   * Stream an object back through the API as a Response. Used so the browser never
   * has to reach Garage directly — avoids mixed-content (HTTPS page → HTTP Garage)
   * and keeps the S3 endpoint private. `preview` sets inline + the right MIME.
   */
  async object(cid: string, bucket: string, key: string, mode: 'download' | 'preview'): Promise<Response> {
    const out = await client(cid).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const ext = (key.toLowerCase().split('.').pop() || '');
    const inline = mode === 'preview' && INLINE.has(ext);
    const filename = key.split('/').pop() || 'file';
    const contentType = (inline && MIME[ext]) ? MIME[ext] : (out.ContentType || 'application/octet-stream');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, max-age=60',
    };
    if (out.ContentLength != null) headers['Content-Length'] = String(out.ContentLength);

    const body = out.Body as { transformToWebStream?: () => ReadableStream; transformToByteArray?: () => Promise<Uint8Array> };
    const stream = typeof body?.transformToWebStream === 'function'
      ? body.transformToWebStream()
      : await body.transformToByteArray!();
    return new Response(stream, { headers });
  },

  async put(cid: string, bucket: string, key: string, data: Uint8Array, contentType?: string): Promise<void> {
    await client(cid).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
  },
  async createFolder(cid: string, bucket: string, key: string): Promise<void> {
    await client(cid).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(0) }));
  },
  async remove(cid: string, bucket: string, keys: string[]): Promise<void> {
    await client(cid).send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  },
};
