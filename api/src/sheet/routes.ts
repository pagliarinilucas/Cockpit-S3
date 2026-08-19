// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Rotas do editor de planilhas: ticket de abertura do WebSocket, criação de
 * planilha nova e o próprio WebSocket de edição.
 */
import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { perms } from '../auth/permissions';
import { audit } from '../audit/store';
import { getKekProvider } from '../crypto/kek';
import { objectsStore } from '../objects/store';
import { usersStore } from '../users/store';
import { s3 } from '../storage/s3';
import type { Role } from '../types';
import { isSheetKey, isZipWorkbook } from './model';
import { newWorkbookBytes } from './import';
import { contentTypeFor, makeSheetIo, parseBucketId } from './io';
import { sheetTickets } from './tickets';
import { decodeFrame } from './protocol';
import {
  applyClientUpdate, attach, broadcast, controlFrame, detach, flush,
  openSession, relayPresence, type LiveSession,
} from './session';

const io = makeSheetIo();

/** Sessão só existe pra quem pode escrever na key — o mesmo canWrite do upload. */
function mayEdit(user: { username: string; role: Role } | null, bucketId: string, key: string): boolean {
  if (!user) return false;
  const access = perms.access(user, bucketId);
  return !!access && perms.canWrite(access, key);
}

/**
 * Revalidação durante a sessão: relê o usuário do banco em vez de confiar no
 * que foi resolvido na abertura, então revogação de grant, troca de role e
 * desativação de conta valem no meio da edição.
 */
function mayEditNow(username: string, bucketId: string, key: string): boolean {
  const u = usersStore.raw(username);
  if (!u || u.active !== 1) return false;
  return mayEdit({ username: u.username, role: u.role }, bucketId, key);
}

let nextClientId = 1;

interface SocketData {
  session: LiveSession;
  clientId: number;
  user: string;
}

const sockets = new Map<string, SocketData>();

export const sheetRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)

  .guard({ beforeHandle: requireUser }, (app) => app
    /** Ticket de uso único para abrir o WS — é aqui que a permissão é conferida. */
    .post('/buckets/:id/sheet-ticket', ({ user, params, body, set }) => {
      const key = body.key;
      if (!parseBucketId(params.id)) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!isSheetKey(key)) { set.status = 415; return { error: 'nao_e_planilha' }; }
      if (!mayEdit(user, params.id, key)) { set.status = 403; return { error: 'forbidden' }; }
      if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }
      return { ticket: sheetTickets.create({ bucketId: params.id, key, user: user!.username }) };
    }, { body: t.Object({ key: t.String() }) })

    /** Cria uma planilha nova e vazia no diretório atual. */
    .post('/buckets/:id/sheets', async ({ user, params, body, set }) => {
      const ref = parseBucketId(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const path = body.path ? (body.path.endsWith('/') ? body.path : body.path + '/') : '';
      const name = body.name.replace(/[\\/]/g, '_').trim();
      if (!name) { set.status = 400; return { error: 'nome_invalido' }; }
      const key = path + (isZipWorkbook(name) ? name : `${name}.xlsx`);
      if (!mayEdit(user, params.id, key)) { set.status = 403; return { error: 'forbidden' }; }
      if (!getKekProvider()) { set.status = 503; return { error: 'sealed' }; }

      const exists = objectsStore.get(params.id, key) !== null
        || await s3.headExists(ref.cid, ref.bucket, key).catch(() => false);
      if (exists) { set.status = 409; return { error: 'ja_existe' }; }

      await io.writeBytes(params.id, key, newWorkbookBytes(), user!.username);
      return { key, contentType: contentTypeFor(key) };
    }, { body: t.Object({ path: t.Optional(t.String()), name: t.String() }) }))

  .ws('/sheets', {
    query: t.Object({ ticket: t.String() }),

    async open(ws) {
      const claim = sheetTickets.consume(ws.data.query.ticket);
      if (!claim) { ws.close(1008, 'ticket_invalido'); return; }

      const clientId = nextClientId++;
      try {
        const session = await openSession({
          bucketId: claim.bucketId,
          key: claim.key,
          io,
          authorize: (username) => mayEditNow(username, claim.bucketId, claim.key),
          onEvent: (s, event) => broadcast(s, controlFrame(event), null),
        });
        sockets.set(ws.id, { session, clientId, user: claim.user });
        attach(session, {
          id: clientId,
          user: claim.user,
          send: (frame) => ws.send(frame),
          close: (code, reason) => ws.close(code, reason),
        });
        audit.log('download', claim.user, claim.bucketId, `editor:${claim.key}`);
      } catch (e) {
        const reason = String((e as Error).message ?? e);
        ws.send(controlFrame({ t: 'error', message: reason }));
        ws.close(1011, reason.slice(0, 120));
      }
    },

    message(ws, raw) {
      const data = sockets.get(ws.id);
      if (!data) { ws.close(1008, 'sem_sessao'); return; }
      const action = decodeFrame(raw);
      if (action.kind === 'update') applyClientUpdate(data.session, action.payload, data.user, data.clientId);
      else if (action.kind === 'presence') relayPresence(data.session, action.payload, data.clientId);
      else if (action.kind === 'save') void flush(data.session, data.user);
    },

    close(ws) {
      const data = sockets.get(ws.id);
      if (!data) return;
      sockets.delete(ws.id);
      detach(data.session, data.clientId);
    },
  });

