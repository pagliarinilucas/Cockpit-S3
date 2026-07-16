// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia } from 'elysia';
import { s3 } from '../storage/s3';
import { audit } from '../audit/store';
import { isCluster, ensureClusterBucketAccess } from '../clusters/access';
import { sharesStore, isUsable } from './store';
import { clientIp } from './ip';
import { objectsStore } from '../objects/store';
import { getKekProvider } from '../crypto/kek';
import { downloadEncrypted } from '../storage/crypto-pipeline';

type Row = NonNullable<ReturnType<typeof sharesStore.get>>;

/** Bucket ids are composite: `<connectionId>:<bucketName>`. */
function parse(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

/** Cluster buckets precisam da key interna liberada (lazy) antes de qualquer op S3. */
async function ensureSource(ref: { cid: string; bucket: string }): Promise<void> {
  if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
}

type SetCtx = { status?: number | string };
type Denied = { error: string };

/**
 * Valida token + trava de IP. Ajusta `set.status` e devolve `{ error }` em caso de falha,
 * ou a `row` quando o acesso é permitido. Compartilhado pelas duas rotas públicas.
 */
function validate(token: string, ip: string, set: SetCtx): Row | Denied {
  const row = sharesStore.get(token);
  if (!row) { set.status = 404; return { error: 'not_found' }; }
  const nowIso = new Date().toISOString();
  if (!isUsable(row, nowIso)) { set.status = 410; return { error: row.revoked ? 'revoked' : 'expired' }; }
  if (row.lockIp) {
    const bound = row.boundIp ?? sharesStore.bindIpIfUnset(token, ip);
    if (bound && bound !== ip) { set.status = 403; return { error: 'ip_locked' }; }
  }
  return row;
}

const isDenied = (r: Row | Denied): r is Denied => 'error' in r;

export const publicShareRoutes = new Elysia({ prefix: '/api' })

  // public metadata for the share page (no login)
  .get('/share/:token', async ({ params, headers, server, request, set }) => {
    const ip = clientIp(headers as Record<string, string | undefined>, server, request);
    const res = validate(params.token, ip, set);
    if (isDenied(res)) return res;
    const ref = parse(res.bucketId);
    if (!ref) { set.status = 404; return { error: 'not_found' }; }
    const filename = res.key.split('/').pop() || 'file';
    const ext = filename.toLowerCase().split('.').pop() || '';
    let size: number | null = null;
    try {
      await ensureSource(ref);
      const row = objectsStore.get(res.bucketId, res.key);
      size = row ? row.sizePlain : (await s3.head(ref.cid, ref.bucket, res.key)).size;
    } catch { /* meta best-effort; size stays null */ }
    return {
      filename,
      size,
      ext,
      previewable: s3.inlinePreviewable(res.key),
      expiresAt: res.expiresAt,
    };
  })

  // stream the shared object (preview or download); no login
  .get('/share/:token/raw', async ({ params, query, headers, server, request, set }) => {
    const ip = clientIp(headers as Record<string, string | undefined>, server, request);
    const res = validate(params.token, ip, set);
    if (isDenied(res)) return res;
    const ref = parse(res.bucketId);
    if (!ref) { set.status = 404; return { error: 'not_found' }; }
    const mode = (query as Record<string, string>)['mode'] === 'download' ? 'download' : 'preview';
    try {
      await ensureSource(ref);
      const row = objectsStore.get(res.bucketId, res.key);
      if (row) {
        // objeto cifrado: decifra via proxy (mesma DEK/stream do fluxo autenticado)
        if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
        const stream = await downloadEncrypted(row, ref.cid, ref.bucket);
        if (mode === 'download') audit.log('download', 'link:' + params.token, res.bucketId, res.key);
        const filename = res.key.split('/').pop() || 'file';
        const disposition = mode === 'download'
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : 'inline';
        return new Response(stream, {
          headers: {
            'Content-Type': row.contentType || 'application/octet-stream',
            'Content-Length': String(row.sizePlain),
            'Content-Disposition': disposition,
          },
        });
      }
      const out = await s3.object(ref.cid, ref.bucket, res.key, mode);
      if (mode === 'download') audit.log('download', 'link:' + params.token, res.bucketId, res.key);
      return out;
    } catch (e) {
      if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
      set.status = 502; return { error: 's3_error' };
    }
  });
