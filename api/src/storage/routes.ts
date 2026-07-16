// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { connectionsStore } from '../connections/store';
import { audit } from '../audit/store';
import { s3 } from './s3';
import { mergeToPdf } from './merge';
import { makeThumb } from './thumb';
import { perms } from '../auth/permissions';
import type { Perm } from '../types';
import { clustersStore } from '../clusters/store';
import { garageAdmin } from '../garage/admin';
import { isCluster, ensureClusterBucketAccess, revokeClusterBucketAccess } from '../clusters/access';
import { bucketAliasStore } from '../buckets/store';
import { mayDeleteBucket } from '../buckets/guard';
import { objectsStore, bucketCryptoStore } from '../objects/store';
import { getKekProvider } from '../crypto/kek';
import { uploadEncrypted, downloadEncrypted } from './crypto-pipeline';

const norm = (p: string) => (p ? (p.endsWith('/') ? p : p + '/') : '');

// short-lived cache for computed bucket stats; keyed by user (usage is now user-scoped).
const statsCache = new Map<string, { at: number; used: number; objects: number; truncated: boolean }>();
const STATS_TTL = 120_000;   // 2 min

/** Bucket ids are composite: `<connectionId>:<bucketName>`. */
function parse(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

/** Cluster buckets precisam da key interna liberada (lazy) antes de qualquer op S3. No-op para conexões. */
async function ensureSource(ref: { cid: string; bucket: string }): Promise<void> {
  if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
}

export const storageRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app

    // list buckets the caller can reach (any grant in the bucket)
    .get('/buckets', async ({ user, set }) => {
      if (!s3.hasAny()) { set.status = 503; return { error: 's3_not_configured' }; }
      const out: { id: string; name: string; connection: string; region: string; perm: Perm; alias?: string }[] = [];
      for (const conn of connectionsStore.list()) {
        if (!s3.has(conn.id)) continue;
        let names: string[];
        try { names = await s3.bucketNames(conn.id); } catch { continue; }
        for (const name of names) {
          const id = `${conn.id}:${name}`;
          const perm = perms.bucketPermFor(user!, id);
          if (perm) out.push({ id, name, connection: conn.name, region: s3.region(conn.id), perm });
        }
      }
      for (const cluster of clustersStore.listFull()) {
        let buckets: { id: string; globalAliases: string[] }[];
        try { buckets = await garageAdmin({ endpoint: cluster.adminEndpoint, token: cluster.adminToken }).listBuckets(); } catch { continue; }
        for (const b of buckets) {
          const name = b.globalAliases[0] ?? b.id;
          const id = `${cluster.id}:${name}`;
          const perm = perms.bucketPermFor(user!, id);
          if (perm) out.push({ id, name, connection: cluster.name, region: cluster.region, perm });
        }
      }
      const aliasMap = bucketAliasStore.getMany(out.map((b) => b.id));
      for (const b of out) b.alias = aliasMap.get(b.id);
      return out;
    })

    // create bucket on a given connection (admin only)
    .post('/buckets', async ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      if (isCluster(body.connectionId)) { set.status = 400; return { error: 'use /api/clusters/:id/buckets' }; }
      if (!s3.has(body.connectionId)) { set.status = 400; return { error: 'unknown_connection' }; }
      try { await s3.createBucket(body.connectionId, body.name); } catch (e) { set.status = 502; return { error: String(e) }; }
      const conn = connectionsStore.get(body.connectionId)!;
      audit.log('bucket', user!.username, body.name, `criou bucket em ${conn.name}`);
      set.status = 201;
      return { id: `${body.connectionId}:${body.name}`, name: body.name, connection: conn.name, region: s3.region(body.connectionId), perm: 'owner' };
    }, { body: t.Object({ connectionId: t.String({ minLength: 1 }), name: t.String({ minLength: 1 }) }) })

    // define/limpa o apelido de um bucket (acesso de escrita ao bucket)
    .patch('/buckets/alias', async ({ user, body, set }) => {
      const ref = parse(body.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const perm = perms.bucketPermFor(user!, body.id);
      if (perm !== 'owner' && perm !== 'read-write') { set.status = 403; return { error: 'forbidden' }; }
      const alias = body.alias.trim();
      if (alias) bucketAliasStore.set(body.id, alias);
      else bucketAliasStore.clear(body.id);
      audit.log('bucket', user!.username, body.id, alias ? `apelido: ${alias}` : 'apelido removido');
      return { ok: true, alias: alias || null };
    }, { body: t.Object({ id: t.String({ minLength: 1 }), alias: t.String({ maxLength: 200 }) }) })

    // consulta se a criptografia em repouso está habilitada no bucket (dono/admin)
    .get('/buckets/:id/encryption', ({ user, params, set }) => {
      const perm = perms.bucketPermFor(user!, params.id);
      if (user!.role !== 'admin' && perm !== 'owner') { set.status = 403; return { error: 'forbidden' }; }
      return {
        enabled: bucketCryptoStore.isEnabled(params.id),
        provider: getKekProvider()?.status() ?? { mode: 'none', sealed: false, currentVersion: null },
      };
    })

    // liga/desliga a criptografia em repouso do bucket (dono/admin); exige provedor de KEK configurado
    .post('/buckets/:id/encryption', ({ user, params, body, set }) => {
      const perm = perms.bucketPermFor(user!, params.id);
      if (user!.role !== 'admin' && perm !== 'owner') { set.status = 403; return { error: 'forbidden' }; }
      if (body.enabled && !getKekProvider()) { set.status = 400; return { error: 'kek_not_configured' }; }
      bucketCryptoStore.setEnabled(params.id, !!body.enabled);
      audit.log('key', user!.username, params.id, body.enabled ? 'encryption:on' : 'encryption:off');
      return { enabled: bucketCryptoStore.isEnabled(params.id) };
    }, { body: t.Object({ enabled: t.Boolean() }) })

    // list objects (paginated) — filtered to what the caller can see at `path`
    .get('/buckets/:id/objects', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const q = query as Record<string, string>;
      const path = norm(q['path'] ?? '');
      const token = q['token'] || undefined;
      const limit = q['limit'] ? Number(q['limit']) : undefined;
      try {
        await ensureSource(ref);
        const { items, nextToken } = await s3.list(ref.cid, ref.bucket, path, { token, limit });
        // cópia defensiva: evita mutar o array retornado por s3.list quando access.all (o push abaixo alteraria a origem)
        let visible = access.all ? items.slice() : items.filter((it) =>
          it.kind === 'folder' ? perms.folderVisible(access, it.key) : perms.canRead(access, it.key));
        // mescla objetos cifrados (linhas em `objects`) neste prefixo — só na 1ª página, p/ não duplicar entre páginas
        if (!token) {
          const encRows = objectsStore.listPrefix(params.id, path);
          const seen = new Set(visible.map((i) => i.key));
          const folderKeys = new Set(visible.filter((i) => i.kind === 'folder').map((i) => i.key));
          for (const r of encRows) {
            const rest = r.key.slice(path.length);
            const slash = rest.indexOf('/');
            if (slash >= 0) {
              // arquivo cifrado em subpasta ainda não listada: sintetiza a pasta virtual
              const fk = path + rest.slice(0, slash + 1);
              if (!folderKeys.has(fk) && (access.all || perms.folderVisible(access, fk))) {
                folderKeys.add(fk);
                visible.push({ kind: 'folder', name: rest.slice(0, slash), key: fk });
              }
            } else if (!seen.has(r.key) && (access.all || perms.canRead(access, r.key))) {
              seen.add(r.key);
              visible.push({ kind: 'file', name: rest, key: r.key, size: r.sizePlain, modified: r.createdAt });
            }
          }
        }
        return { bucket: params.id, path, items: visible, perm: perms.permForKey(access, path), nextToken };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // computed bucket usage (scoped to readable keys) — cached briefly per user
    .get('/buckets/:id/stats', async ({ user, params, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const cacheKey = `${user!.username}|${params.id}`;
      const hit = statsCache.get(cacheKey);
      if (hit && Date.now() - hit.at < STATS_TTL) return { used: hit.used, objects: hit.objects, truncated: hit.truncated };
      try {
        await ensureSource(ref);
        const keep = access.all ? undefined : (k: string) => perms.canRead(access, k);
        const s = await s3.stats(ref.cid, ref.bucket, keep);
        statsCache.set(cacheKey, { at: Date.now(), ...s });
        return s;
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // recursive search under a prefix — results filtered to readable keys
    .get('/buckets/:id/search', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const q = (query as Record<string, string>)['q']?.trim() ?? '';
      if (!q) return { bucket: params.id, items: [] };
      const path = norm((query as Record<string, string>)['path'] ?? '');
      const limit = Math.min(1000, Math.max(1, Number((query as Record<string, string>)['limit']) || 300));
      try {
        await ensureSource(ref);
        const items = await s3.search(ref.cid, ref.bucket, path, q, limit);
        const visible = access.all ? items : items.filter((it) => perms.canRead(access, it.key));
        return { bucket: params.id, path, items: visible };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    .get('/buckets/:id/download', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canDownload(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      // objeto cifrado: não há URL presignada de plaintext — devolve URL de proxy same-origin (/raw decifra em streaming)
      if (objectsStore.get(params.id, key)) {
        audit.log('download', user!.username, params.id, key);
        return { url: `/api/buckets/${params.id}/raw?key=${encodeURIComponent(key)}&mode=download`, disposition: 'attachment' };
      }
      const r = await s3.presign(ref.cid, ref.bucket, key, 'download');
      audit.log('download', user!.username, params.id, key);
      return r;
    })

    .get('/buckets/:id/preview', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      // view-only só pré-visualiza tipos inline; tipos não-inline virariam attachment (=download).
      if (!perms.canDownload(access, key) && !s3.inlinePreviewable(key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      return s3.presign(ref.cid, ref.bucket, key, 'preview');
    })

    .get('/buckets/:id/raw', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const q = query as Record<string, string>;
      const key = q['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      const mode = q['mode'] === 'download' ? 'download' : 'preview';
      if (mode === 'download' && !perms.canDownload(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      // view-only: preview de tipo não-inline seria attachment (=download) → bloqueia.
      if (mode === 'preview' && !perms.canDownload(access, key) && !s3.inlinePreviewable(key)) { set.status = 403; return { error: 'forbidden' }; }
      try {
        await ensureSource(ref);
        // objeto cifrado: decifra em streaming a partir do blob real (s3Key), sem tocar no plaintext em disco
        const row = objectsStore.get(params.id, key);
        if (row) {
          if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
          const stream = await downloadEncrypted(row, ref.cid, ref.bucket);
          if (mode === 'download') audit.log('download', user!.username, params.id, key);
          const filename = key.split('/').pop() || 'file';
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
        const res = await s3.object(ref.cid, ref.bucket, key, mode);
        if (mode === 'download') audit.log('download', user!.username, params.id, key);
        return res;
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // junta imagens/PDFs selecionados (na ordem recebida) num único PDF — só leitura
    .post('/buckets/:id/merge-pdf', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access) { set.status = 403; return { error: 'forbidden' }; }
      for (const k of body.keys) if (!perms.canDownload(access, k)) { set.status = 403; return { error: 'forbidden' }; }
      try {
        await ensureSource(ref);
        const { pdf, skipped } = await mergeToPdf(body.keys, (key) => s3.bytes(ref.cid, ref.bucket, key));
        if (!pdf) { set.status = 422; return { error: 'no_mergeable_content', skipped }; }
        const name = (body.filename?.trim() || 'combinado').replace(/\.pdf$/i, '');
        audit.log('download', user!.username, params.id, `merge-pdf (${body.keys.length} itens) -> ${name}.pdf`);
        return new Response(pdf, { headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.pdf')}`,
          'Cache-Control': 'no-store',
          ...(skipped.length ? { 'X-Merge-Skipped': String(skipped.length) } : {}),
        } });
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    }, { body: t.Object({
      keys: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
      filename: t.Optional(t.String({ maxLength: 200 })),
    }) })

    // miniatura (imagem redimensionada / 1ª página do PDF) — só leitura, cacheável
    .get('/buckets/:id/thumb', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      try {
        await ensureSource(ref);
        const data = await s3.bytes(ref.cid, ref.bucket, key);
        const thumb = await makeThumb(data);
        if (!thumb) { set.status = 415; return { error: 'no_thumbnail' }; }   // front cai no ícone
        return new Response(thumb.bytes, { headers: {
          'Content-Type': thumb.mime,
          'Cache-Control': 'private, max-age=3600',
        } });
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    .post('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const path = norm(body.path ?? '');
      const file = body.file;
      const key = path + file.name;
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      const data = new Uint8Array(await file.arrayBuffer());
      await s3.put(ref.cid, ref.bucket, key, data, file.type || undefined);
      audit.log('upload', user!.username, params.id, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), file: t.File() }) })

    // Upload cifrado (corpo cru streaming). Só quando o bucket é cifrado.
    .post('/buckets/:id/objects-encrypted', async ({ user, params, query, request, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const bucketId = params.id;
      const access = perms.access(user!, bucketId);
      const q = query as Record<string, string>;
      const path = norm(q['path'] ?? '');
      const name = String(q['name'] ?? '');
      const key = path + name;
      if (!name) { set.status = 400; return { error: 'missing_name' }; }
      // autoriza antes de checar config do bucket/provedor — evita que quem não tem acesso sonde essas infos
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      if (!s3.hasAny()) { set.status = 503; return { error: 's3_not_configured' }; }
      if (!bucketCryptoStore.isEnabled(bucketId)) { set.status = 400; return { error: 'bucket_not_encrypted' }; }
      if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
      const sizePlain = Number(q['size'] ?? request.headers.get('x-plain-size') ?? NaN);
      if (!Number.isFinite(sizePlain) || sizePlain < 0) { set.status = 400; return { error: 'bad_size' }; }
      if (!request.body) { set.status = 400; return { error: 'no_body' }; }
      try {
        await ensureSource(ref);
        await uploadEncrypted({
          cid: ref.cid, bucket: ref.bucket, bucketId, key, sizePlain,
          contentType: request.headers.get('x-content-type') || 'application/octet-stream',
          body: request.body as ReadableStream<Uint8Array>,
        });
        audit.log('upload', user!.username, bucketId, key);
        set.status = 201; return { ok: true, key };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 500; return { error: 'upload_failed' };
      }
    })

    .post('/buckets/:id/folders', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = norm(body.path ?? '') + body.name + '/';
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      await s3.createFolder(ref.cid, ref.bucket, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), name: t.String({ minLength: 1 }) }) })

    .delete('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access) { set.status = 403; return { error: 'forbidden' }; }
      for (const k of body.keys) if (!perms.canWrite(access, k)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      // objetos cifrados (linha em `objects`) apagam o blob opaco + a linha; keys legadas seguem o delete em lote
      const legacyKeys: string[] = [];
      for (const k of body.keys) {
        const removed = objectsStore.remove(params.id, k);
        if (removed) { await s3.removeKey(ref.cid, ref.bucket, removed.s3Key).catch((e) => console.error('[crypto] falha ao remover blob', removed.s3Key, (e as Error).message)); }
        else { legacyKeys.push(k); }
      }
      if (legacyKeys.length) await s3.remove(ref.cid, ref.bucket, legacyKeys);
      for (const k of body.keys) audit.log('delete', user!.username, params.id, k);
      return { ok: true };
    }, { body: t.Object({ keys: t.Array(t.String(), { minItems: 1 }) }) })

    .delete('/buckets/:id', async ({ user, params, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const perm = perms.bucketPermFor(user!, params.id);
      if (perm !== 'owner') { set.status = 403; return { error: 'forbidden' }; }
      try {
        await ensureSource(ref);
        const empty = await s3.isEmpty(ref.cid, ref.bucket);
        if (!mayDeleteBucket(perm, empty)) { set.status = 409; return { error: 'bucket_not_empty' }; }
        if (isCluster(ref.cid)) {
          const c = clustersStore.getFull(ref.cid);
          if (!c) { set.status = 404; return { error: 'cluster_not_found' }; }
          const g = garageAdmin({ endpoint: c.adminEndpoint, token: c.adminToken });
          const hexId = await g.resolveBucketId(ref.bucket);
          await g.deleteBucket(hexId);
          revokeClusterBucketAccess(ref.cid, ref.bucket);
        } else {
          await s3.deleteBucket(ref.cid, ref.bucket);
        }
        bucketAliasStore.clear(params.id);
        for (const k of [...statsCache.keys()]) if (k.endsWith(`|${params.id}`)) statsCache.delete(k);
        audit.log('bucket', user!.username, params.id, 'excluiu bucket');
        return { ok: true };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: String((e as Error)?.message || e) };
      }
    }),
  );
