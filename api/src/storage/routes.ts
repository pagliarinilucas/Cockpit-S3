// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { connectionsStore } from '../connections/store';
import { audit } from '../audit/store';
import { s3, type S3Item } from './s3';
import { mergeToPdf } from './merge';
import { zipStream, type ZipEntry } from './zip';
import { zipTickets } from './zip-tickets';
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
import { downloadEncrypted, uploadEncryptedFromRequest } from './crypto-pipeline';
import { hasSessionUnder } from '../sheet/session';
import { config, readKekBytes } from '../config';
import { createHash } from 'node:crypto';

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

/** Lê um ReadableStream<Uint8Array> por completo, concatenando os chunks. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  return new Uint8Array(await new Response(new Blob(chunks)).arrayBuffer());
}

/** Cluster buckets precisam da key interna liberada (lazy) antes de qualquer op S3. No-op para conexões. */
async function ensureSource(ref: { cid: string; bucket: string }): Promise<void> {
  if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function safeZipName(raw?: string): string {
  const cleaned = (raw ?? '')
    .replace(/\.zip$/i, '')
    .replace(/[\\/]/g, '_')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned || 'arquivos';
}

export const storageRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)

  .get('/buckets/:id/zip', async ({ params, query, set }) => {
    const ref = parse(params.id);
    if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
    const id = (query as Record<string, string>)['ticket'];
    if (!id) { set.status = 400; return { error: 'missing_ticket' }; }
    const ticket = zipTickets.consume(id, params.id);
    if (!ticket) { set.status = 404; return { error: 'bad_ticket' }; }
    try {
      await ensureSource(ref);
      const enc = bucketCryptoStore.isEnabled(params.id);
      const fetchEntry = (key: string): Promise<ReadableStream<Uint8Array>> => {
        if (enc) {
          const row = objectsStore.get(params.id, key);
          if (row) return downloadEncrypted(row, ref.cid, ref.bucket);
        }
        return s3.stream(ref.cid, ref.bucket, key);
      };
      const stream = zipStream(ticket.entries, fetchEntry);
      return new Response(stream, { headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ticket.filename + '.zip')}`,
        'Cache-Control': 'no-store',
      } });
    } catch (e) {
      if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
      set.status = 502; return { error: 's3_error' };
    }
  })

  .guard({ beforeHandle: requireUser }, (app) => app

    // list buckets the caller can reach (any grant in the bucket)
    .get('/buckets', async ({ user, set }) => {
      if (!s3.hasAny()) { set.status = 503; return { error: 's3_not_configured' }; }
      const out: { id: string; name: string; connection: string; region: string; perm: Perm; alias?: string; encrypted?: boolean }[] = [];
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
      for (const b of out) { b.alias = aliasMap.get(b.id); b.encrypted = bucketCryptoStore.isEnabled(b.id); }
      return out;
    })

    // create bucket on a given connection (admin only)
    .post('/buckets', async ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      if (isCluster(body.connectionId)) { set.status = 400; return { error: 'use /api/clusters/:id/buckets' }; }
      if (!s3.has(body.connectionId)) { set.status = 400; return { error: 'unknown_connection' }; }
      // Se pedir cifrado, exige KEK ANTES de criar (evita criar um bucket que não conseguiríamos cifrar).
      if (body.encrypted && !getKekProvider()) { set.status = 400; return { error: 'kek_not_configured' }; }
      try { await s3.createBucket(body.connectionId, body.name); } catch (e) { set.status = 502; return { error: String(e) }; }
      const bucketId = `${body.connectionId}:${body.name}`;
      // Bucket recém-criado está vazio → a regra "só cifra bucket vazio" é satisfeita por construção.
      if (body.encrypted) { bucketCryptoStore.setEnabled(bucketId, true); audit.log('key', user!.username, bucketId, 'encryption:on'); }
      const conn = connectionsStore.get(body.connectionId)!;
      audit.log('bucket', user!.username, body.name, `criou bucket em ${conn.name}${body.encrypted ? ' (cifrado)' : ''}`);
      set.status = 201;
      return { id: bucketId, name: body.name, connection: conn.name, region: s3.region(body.connectionId), perm: 'owner', encrypted: !!body.encrypted };
    }, { body: t.Object({ connectionId: t.String({ minLength: 1 }), name: t.String({ minLength: 1 }), encrypted: t.Optional(t.Boolean()) }) })

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
    .post('/buckets/:id/encryption', async ({ user, params, body, set }) => {
      const perm = perms.bucketPermFor(user!, params.id);
      if (user!.role !== 'admin' && perm !== 'owner') { set.status = 403; return { error: 'forbidden' }; }
      if (body.enabled) {
        if (!getKekProvider()) { set.status = 400; return { error: 'kek_not_configured' }; }
        // Ao LIGAR a criptografia, o bucket precisa estar VAZIO. Senão ele viraria um bucket
        // "cifrado" contendo objetos plaintext legados que continuam legíveis — mistura
        // confusa e vazamento do que a feature promete esconder. Exige zero objetos no S3
        // E zero metadados cifrados (cobre também blobs órfãos de uma limpeza que falhou).
        const ref = parse(params.id);
        if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
        try {
          await ensureSource(ref);
          const empty = (await s3.isEmpty(ref.cid, ref.bucket)) && objectsStore.listS3Keys(params.id).size === 0;
          if (!empty) { set.status = 409; return { error: 'bucket_not_empty' }; }
        } catch (e) {
          if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
          set.status = 502; return { error: 's3_error' };
        }
      }
      bucketCryptoStore.setEnabled(params.id, !!body.enabled);
      audit.log('key', user!.username, params.id, body.enabled ? 'encryption:on' : 'encryption:off');
      return { enabled: bucketCryptoStore.isEnabled(params.id) };
    }, { body: t.Object({ enabled: t.Boolean() }) })

    // revela a KEK crua para backup/disaster-recovery (SOMENTE admin). Devolve o segredo
    // em base64 para o admin guardar num cofre offline. Perder a KEK = dados cifrados
    // irrecuperáveis; por isso essa saída existe. NUNCA logamos o valor — só a ação
    // (o teste de higiene em crypto/hygiene.test.ts proíbe console.* de material de chave).
    .get('/kek', ({ user, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      const provider = getKekProvider();
      if (!provider) { set.status = 400; return { error: 'kek_not_configured' }; }
      let kek: Buffer | null;
      try { kek = readKekBytes(); } catch { set.status = 500; return { error: 'kek_unreadable' }; }
      if (!kek) { set.status = 400; return { error: 'kek_not_configured' }; }
      // impressão digital estável (não reversível) p/ o admin conferir qual KEK é sem expor o valor nos logs
      const fingerprint = createHash('sha256').update(kek).digest('hex').slice(0, 16);
      audit.log('key', user!.username, '—', 'revelou a KEK (backup)');
      return { version: provider.status().currentVersion, fingerprint, kekBase64: kek.toString('base64') };
    })

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
        // oculta os blobs opacos (s3_key UUID) que o s3.list devolve — eles nunca devem
        // aparecer na API; os nomes reais vêm da mescla com a tabela `objects` abaixo.
        const s3keys = objectsStore.listS3Keys(params.id);
        const realItems = items.filter((it) => !(it.kind === 'file' && s3keys.has(it.key)));
        // cópia defensiva: evita mutar o array retornado por s3.list quando access.all (o push abaixo alteraria a origem)
        let visible = access.all ? realItems.slice() : realItems.filter((it) =>
          it.kind === 'folder' ? perms.folderVisible(access, it.key) : perms.canRead(access, it.key));
        // mescla objetos cifrados (linhas em `objects`) neste prefixo — só na 1ª página, p/ não duplicar entre páginas
        if (!token) {
          const encRows = objectsStore.listPrefix(params.id, path);
          const seen = new Set(visible.map((i) => i.key));
          const folderKeys = new Set(visible.filter((i) => i.kind === 'folder').map((i) => i.key));
          for (const r of encRows) {
            const rest = r.key.slice(path.length);
            if (!rest) continue; // marcador da própria pasta corrente
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
          // re-ordena após a mescla: pastas primeiro, depois por nome (mesmo critério do s3.list).
          // Nota (Fase 1): NÃO truncamos por `limit` aqui — como a mescla de linhas cifradas só
          // ocorre na 1ª página (!token) e o nextToken do S3 não as inclui, aplicar slice(limit)
          // esconderia itens cifrados que nunca apareceriam em página nenhuma. Para pastas
          // cifradas grandes a 1ª página pode exceder `limit` — limitação documentada da Fase 1,
          // preferível a ocultar itens silenciosamente.
          visible.sort((a, b) => a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name));
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
        // objetos cifrados aparecem no S3 como blobs opacos (s3_key UUID) com tamanho
        // CIFRADO — exclui exatamente as s3_keys atuais (mesma fonte usada na listagem em
        // /objects) da soma do S3 e soma o plaintext à parte. Blobs órfãos de uma limpeza
        // best-effort que falhou (raros) não têm mais linha em `objects`: ficam fora desse
        // filtro e são tratados pelo futuro sweeper de GC, não aqui.
        const encS3Keys = objectsStore.listS3Keys(params.id);
        const keep = (k: string) => (access.all || perms.canRead(access, k)) && !encS3Keys.has(k);
        const s = await s3.stats(ref.cid, ref.bucket, keep);
        for (const row of objectsStore.listPrefix(params.id, '')) {
          if (row.key.endsWith('/')) continue;   // marcador de pasta cifrada — não conta como objeto
          if (access.all || perms.canRead(access, row.key)) { s.used += row.sizePlain; s.objects++; }
        }
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
        let visible = access.all ? items : items.filter((it) => perms.canRead(access, it.key));
        // mescla objetos cifrados (linhas em `objects`) cuja key bate com a busca — não passam pelo s3.search legado
        const encRows = objectsStore.listPrefix(params.id, path);
        const ql = q.toLowerCase();
        const seen = new Set(visible.map((it) => it.key));
        for (const r of encRows) {
          const base = r.key.slice(path.length);
          if (!base.toLowerCase().includes(ql)) continue;
          if (seen.has(r.key)) continue;
          if (!access.all && !perms.canRead(access, r.key)) continue;
          seen.add(r.key);
          visible.push({ kind: 'file', name: r.key.split('/').pop() || r.key, key: r.key, size: r.sizePlain, modified: r.createdAt });
        }
        // re-ordena após a mescla: pastas primeiro, depois por nome (mesmo critério do s3.list).
        visible.sort((a, b) => a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name));
        if (visible.length > limit) visible = visible.slice(0, limit);
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
      // objeto cifrado: não há URL presignada de plaintext — devolve URL de proxy same-origin (/raw decifra em streaming)
      if (objectsStore.get(params.id, key)) {
        return { url: `/api/buckets/${params.id}/raw?key=${encodeURIComponent(key)}&mode=preview`, disposition: 'inline' as const };
      }
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
        // Resolve a linha da DB de cada key UMA ÚNICA VEZ (evita 2 lookups por key: um pro
        // somatório de tamanho, outro pro fetch de bytes do merge em si) e reaproveita tanto
        // no teto de tamanho quanto no fetchBytes abaixo.
        const rows = body.keys.map((k) => ({ k, row: objectsStore.get(params.id, k) }));

        // Teto de tamanho TOTAL: o merge carrega cada arquivo inteiro em memória (pdf-lib
        // precisa dos bytes completos), então a soma dos selecionados vira RSS. Recusa acima
        // do teto (default 2 GiB) em vez de arriscar estourar a memória do servidor.
        // Em paralelo (não sequencial): cada HEAD é uma chamada de rede independente.
        // Key legada que sumiu (404 estruturado) não derruba a soma — conta como 0.
        const sizes = await Promise.all(rows.map(async ({ k, row }): Promise<number | null> => {
          if (row) return row.sizePlain;
          try {
            return (await s3.head(ref.cid, ref.bucket, k)).size ?? 0;
          } catch (e) {
            const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } });
            if (n?.name === 'NotFound' || n?.name === 'NoSuchKey' || n?.$metadata?.httpStatusCode === 404) return null;
            throw e;
          }
        }));
        const totalBytes = sizes.reduce((a: number, s) => a + (s ?? 0), 0);
        if (totalBytes > config.mergePdfMaxTotalBytes) { set.status = 413; return { error: 'merge_too_large' }; }
        // objeto cifrado: o blob real está sob uma key UUID opaca — decifra em memória
        // antes de entregar ao merge; objeto legado segue lendo direto do S3. Reaproveita
        // o `row` já resolvido acima (sem reconsultar a DB).
        const rowByKey = new Map(rows.map((r) => [r.k, r.row]));
        const fetchBytes = async (key: string): Promise<Uint8Array> => {
          const row = rowByKey.get(key);
          if (row) {
            if (!getKekProvider()) throw new Error('sealed');
            return readAll(await downloadEncrypted(row, ref.cid, ref.bucket));
          }
          return s3.bytes(ref.cid, ref.bucket, key);
        };
        const { pdf, skipped } = await mergeToPdf(body.keys, fetchBytes);
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

    .post('/buckets/:id/zip-ticket', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access) { set.status = 403; return { error: 'forbidden' }; }

      const path = norm(body.path ?? '');
      const targets = body.prefix ? [norm(body.prefix)] : (body.keys ?? []);
      if (!!body.prefix === !!body.keys?.length || targets.length === 0) {
        set.status = 400; return { error: 'bad_request' };
      }
      for (const key of targets) if (!key.startsWith(path)) { set.status = 400; return { error: 'bad_request' }; }

      try {
        await ensureSource(ref);
        const enc = bucketCryptoStore.isEnabled(params.id);
        const found = new Map<string, S3Item>();
        let truncated = false;
        const singles: string[] = [];

        for (const target of targets) {
          if (target.endsWith('/')) {
            if (enc) {
              for (const row of objectsStore.listPrefix(params.id, target)) {
                if (!found.has(row.key)) found.set(row.key, { kind: 'file', name: row.key.split('/').pop() || row.key, key: row.key, size: row.sizePlain });
              }
            } else {
              const listed = await s3.listAllUnder(ref.cid, ref.bucket, target);
              truncated = truncated || listed.truncated;
              for (const item of listed.items) if (!found.has(item.key)) found.set(item.key, item);
            }
          } else if (!found.has(target)) {
            found.set(target, { kind: 'file', name: target.split('/').pop() || target, key: target, size: 0 });
            singles.push(target);
          }
        }

        if (found.size === 0) { set.status = 422; return { error: 'nothing_to_zip' }; }
        if (truncated) { set.status = 413; return { error: 'listing_truncated' }; }

        const allowed = [...found.values()].filter((item) => access.all || perms.canDownload(access, item.key));
        if (allowed.length === 0) { set.status = 403; return { error: 'forbidden' }; }
        if (allowed.length > config.zipMaxEntries) { set.status = 413; return { error: 'too_many_entries' }; }

        const singleSet = new Set(singles);
        await Promise.all(allowed.filter((item) => singleSet.has(item.key)).map(async (item) => {
          try {
            if (enc) {
              const row = objectsStore.get(params.id, item.key);
              item.size = row?.sizePlain ?? 0;
              item.modified = row?.createdAt;
            } else {
              const meta = await s3.head(ref.cid, ref.bucket, item.key);
              item.size = meta.size;
              item.modified = meta.modified;
            }
          } catch { item.size = 0; }
        }));

        const entries: ZipEntry[] = allowed.map((item) => ({
          key: item.key,
          name: item.key.slice(path.length),
          size: item.size ?? 0,
          modified: item.modified,
        }));
        const filename = safeZipName(body.filename);
        const ticket = zipTickets.create({ bucketId: params.id, owner: user!.username, filename, entries });
        audit.log('download', user!.username, params.id, `zip (${entries.length} itens) -> ${filename}.zip`);
        return {
          ticket,
          count: entries.length,
          totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
          filename,
        };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    }, { body: t.Object({
      path: t.Optional(t.String({ maxLength: 1024 })),
      prefix: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
      keys: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 1024 }), { maxItems: 5000 })),
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
        // objeto cifrado: decifra em memória antes de gerar a miniatura
        const row = objectsStore.get(params.id, key);
        let data: Uint8Array;
        if (row) {
          if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
          data = await readAll(await downloadEncrypted(row, ref.cid, ref.bucket));
        } else {
          data = await s3.bytes(ref.cid, ref.bucket, key);
        }
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
      // bucket cifrado: o upload legado grava plaintext direto no bucket — bloqueia e
      // manda o cliente usar o endpoint cifrado (streaming) em vez deste.
      if (bucketCryptoStore.isEnabled(params.id)) { set.status = 400; return { error: 'bucket_encrypted_use_encrypted_endpoint' }; }
      if (file.size > config.uploadMaxInMemoryBytes) { set.status = 413; return { error: 'file_too_large' }; }
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
      if (!request.body) { set.status = 400; return { error: 'no_body' }; }
      const contentType = request.headers.get('x-content-type') || 'application/octet-stream';
      // Roteamento por BYTES REAIS, nunca pelo tamanho declarado pelo cliente (Content-Length
      // e ?size são auto-declarados — um cliente malicioso pode mentir, inclusive via chunked
      // encoding). uploadEncryptedFromRequest cuida do spool (memória/disco) + dispose do temp.
      try {
        await ensureSource(ref);
        await uploadEncryptedFromRequest({ cid: ref.cid, bucket: ref.bucket, bucketId, key, contentType, body: request.body as ReadableStream<Uint8Array> });
        audit.log('upload', user!.username, bucketId, key);
        set.status = 201; return { ok: true, key };
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOSPC' || String(e).includes('ENOSPC')) { set.status = 507; return { error: 'insufficient_storage' }; }
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 500; return { error: 'upload_failed' };
      }
    }, { parse: 'none' })
    // `parse: 'none'` desliga o body parser embutido do Elysia (que bufferiza tudo via
    // arrayBuffer() ANTES do handler). Assim `request.body` continua o ReadableStream cru,
    // lido chunk a chunk: o roteamento memória-vs-disco é decidido pelos bytes REAIS que
    // chegam, nunca pelo tamanho que o cliente declarou.

    .post('/buckets/:id/folders', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = norm(body.path ?? '') + body.name + '/';
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      if (bucketCryptoStore.isEnabled(params.id)) {
        // Bucket cifrado: NÃO grava marcador com nome real (vazaria a estrutura no bucket).
        // Cria um marcador de pasta CIFRADO (objeto de 0 bytes com key = caminho da pasta):
        // o blob no bucket é um UUID opaco e a pasta aparece como virtual na listagem.
        if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
        const empty = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
        await uploadEncryptedFromRequest({ cid: ref.cid, bucket: ref.bucket, bucketId: params.id, key, contentType: 'application/x-directory', body: empty });
        return { ok: true, key };
      }
      await s3.createFolder(ref.cid, ref.bucket, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), name: t.String({ minLength: 1 }) }) })

    .delete('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access) { set.status = 403; return { error: 'forbidden' }; }
      for (const k of body.keys) if (!perms.canWrite(access, k)) { set.status = 403; return { error: 'forbidden' }; }
      // Apagar arquivo com editor de planilha aberto órfãria o documento vivo (o docId
      // deriva de bucket+key) e faria a materialização recriar o objeto depois.
      const busy = body.keys.filter((k) => hasSessionUnder(params.id, k));
      if (busy.length) { set.status = 409; return { error: 'em_edicao', keys: busy }; }
      await ensureSource(ref);
      // Uma passada: resolve cada key lógica para {key, s3Key, enc} — cifradas (linha em
      // `objects`) mapeiam pro blob opaco s3_key; legadas usam a própria key como s3Key.
      const entries = body.keys.map((k) => {
        const row = objectsStore.get(params.id, k);
        return row ? { key: k, s3Key: row.s3Key, enc: true } : { key: k, s3Key: k, enc: false };
      });
      // Deleta no S3 PRIMEIRO; só remove as linhas da DB depois do sucesso — assim uma
      // falha no S3 não órfã o blob nem perde o mapeamento (a linha guarda a DEK/stream_header;
      // sem ela o blob fica indecifrável).
      let failedS3: string[];
      try {
        failedS3 = await s3.remove(ref.cid, ref.bucket, entries.map((e) => e.s3Key));
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
      const failedSet = new Set(failedS3);
      const failedKeys: string[] = [];
      for (const e of entries) {
        if (failedSet.has(e.s3Key)) { failedKeys.push(e.key); continue; }   // não confirmado no S3: mantém a linha
        if (e.enc) objectsStore.deleteRow(params.id, e.key);
        audit.log('delete', user!.username, params.id, e.key);
      }
      // Falha parcial: 207 (Multi-Status) em vez de 200 — ainda é 2xx (cliente recarrega a
      // listagem e vê o estado real, sem lançar), mas monitores baseados em status enxergam
      // que nem tudo confirmou. `failed` traz as keys LÓGICAS (não os s3_key opacos).
      if (failedKeys.length) { set.status = 207; return { ok: false, failed: failedKeys }; }
      return { ok: true };
      // maxItems=1000: limite do DeleteObjects do S3 numa única chamada.
    }, { body: t.Object({ keys: t.Array(t.String(), { minItems: 1, maxItems: 1000 }) }) })

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
