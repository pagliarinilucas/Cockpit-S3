// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Sessões vivas de edição: um Y.Doc por arquivo, compartilhado pelos clientes
 * conectados. O doc é o estado autoritativo enquanto a sessão existe; o S3 é
 * atualizado por materialização (ociosidade, saída do último cliente ou pedido
 * explícito). Persiste cada update no banco cifrado, então derrubar o processo
 * não perde edição.
 */
import * as Y from 'yjs';
import { docIdFor, MAX_BYTES, MAX_CELLS } from './model';
import { parseWorkbook } from './import';
import { applyWorkbook, cellCount, sheetNames } from './ydoc';
import { sheetStore } from './store';
import { materialize, type MaterializeResult, type SheetIo } from './materialize';
import { FRAME_CONTROL, FRAME_PRESENCE, FRAME_UPDATE, controlFrame, frame } from './protocol';

export const IDLE_SAVE_MS = 30_000;
export const COMPACT_AFTER_UPDATES = 200;

export interface SessionClient {
  id: number;
  user: string;
  send(frame: Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface LiveSession {
  docId: string;
  bucketId: string;
  key: string;
  doc: Y.Doc;
  clients: Map<number, SessionClient>;
  presence: Map<number, string>;
  fingerprint: string | null;
  diverged: boolean;
  saving: boolean;
  io: SheetIo;
  authorize: (user: string) => boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  onEvent: (session: LiveSession, event: SessionEvent) => void;
  /** Último a editar: é em nome dele que a materialização automática grava. */
  lastAuthor: string | null;
}

export type SessionEvent =
  | { t: 'saved'; changed: number }
  | { t: 'unchanged' }
  | { t: 'diverged' }
  | { t: 'error'; message: string };

const sessions = new Map<string, LiveSession>();
// Aberturas em voo: dois clientes entrando junto no mesmo arquivo têm que
// receber a MESMA sessão — sem isso cada um ganharia um Y.Doc próprio e as
// edições de um seriam invisíveis pro outro.
const opening = new Map<string, Promise<LiveSession>>();

export { FRAME_CONTROL, FRAME_PRESENCE, FRAME_UPDATE, controlFrame, frame };

/**
 * Abre (ou reaproveita) a sessão do arquivo. Regra de estado velho: se o doc
 * salvo está limpo mas o arquivo no S3 mudou, o arquivo é mais novo e o doc é
 * descartado; se o doc está sujo e o arquivo mudou, abre em modo divergente —
 * nunca escolhe sozinho qual versão perder.
 */
export async function openSession(a: {
  bucketId: string;
  key: string;
  io: SheetIo;
  authorize: (user: string) => boolean;
  onEvent: (session: LiveSession, event: SessionEvent) => void;
}): Promise<LiveSession> {
  const docId = docIdFor(a.bucketId, a.key);
  const existing = sessions.get(docId);
  if (existing) return existing;
  const inFlight = opening.get(docId);
  if (inFlight) return inFlight;

  const promise = buildSession(docId, a).finally(() => { opening.delete(docId); });
  opening.set(docId, promise);
  return promise;
}

async function buildSession(docId: string, a: {
  bucketId: string;
  key: string;
  io: SheetIo;
  authorize: (user: string) => boolean;
  onEvent: (session: LiveSession, event: SessionEvent) => void;
}): Promise<LiveSession> {
  const fingerprint = await a.io.fingerprint(a.bucketId, a.key);
  const stored = sheetStore.find(docId);
  const doc = new Y.Doc();
  let diverged = false;

  const staleDoc = !!stored && (stored.fingerprint ?? null) !== (fingerprint ?? null);
  const reuseStored = !!stored && (!staleDoc || stored.dirty === 1);

  if (reuseStored) {
    const loaded = sheetStore.load(docId);
    if (loaded) for (const update of loaded.updates) Y.applyUpdate(doc, update, 'db');
    diverged = staleDoc;
  } else {
    if (stored) sheetStore.remove(docId);
    const bytes = await a.io.fetchBytes(a.bucketId, a.key);
    // Teto de bytes ANTES de parsear: um xlsx enorme travaria o processo já na
    // leitura, antes de qualquer contagem de células.
    if (bytes.byteLength > MAX_BYTES) throw new Error('planilha_grande');
    applyWorkbook(doc, parseWorkbook(bytes, a.key));
    if (cellCount(doc) > MAX_CELLS) throw new Error('planilha_grande');
    sheetStore.create({ docId, bucketId: a.bucketId, key: a.key, fingerprint, snapshot: Y.encodeStateAsUpdate(doc) });
  }

  const session: LiveSession = {
    docId, bucketId: a.bucketId, key: a.key, doc,
    clients: new Map(), presence: new Map(),
    fingerprint, diverged, saving: false,
    io: a.io, authorize: a.authorize, idleTimer: null, onEvent: a.onEvent,
    lastAuthor: null,
  };
  sessions.set(docId, session);
  return session;
}

export const findSession = (bucketId: string, key: string): LiveSession | null =>
  sessions.get(docIdFor(bucketId, key)) ?? null;

/**
 * Há sessão de edição viva em alguma key sob este prefixo? Conta também a
 * sessão sem clientes que ainda está materializando: apagar nessa janela faria
 * a materialização recriar o objeto logo depois.
 */
export function hasSessionUnder(bucketId: string, prefix: string): boolean {
  for (const s of sessions.values()) {
    if (s.bucketId === bucketId && s.key.startsWith(prefix)) return true;
  }
  return false;
}


export function attach(session: LiveSession, client: SessionClient): void {
  session.clients.set(client.id, client);
  client.send(frame(FRAME_UPDATE, Y.encodeStateAsUpdate(session.doc)));
  client.send(controlFrame({
    t: 'ready',
    sheets: sheetNames(session.doc),
    diverged: session.diverged,
    peers: [...session.clients.values()].map((c) => ({ id: c.id, user: c.user })),
  }));
  broadcastPeers(session);
}

export function detach(session: LiveSession, clientId: number): void {
  session.clients.delete(clientId);
  session.presence.delete(clientId);
  if (session.clients.size) { broadcastPeers(session); return; }
  clearIdle(session);
  // Materializa em nome de quem editou por último: `authorize` precisa de um
  // usuário real, e um nome fictício faria o flush final ser sempre recusado.
  void flush(session, session.lastAuthor ?? '').finally(() => {
    if (!session.clients.size) {
      session.doc.destroy();
      sessions.delete(session.docId);
    }
  });
}

function broadcastPeers(session: LiveSession): void {
  const peers = [...session.clients.values()].map((c) => ({ id: c.id, user: c.user }));
  broadcast(session, controlFrame({ t: 'peers', peers }), null);
}

export function broadcast(session: LiveSession, data: Uint8Array, exceptClientId: number | null): void {
  for (const [id, client] of session.clients) {
    if (id === exceptClientId) continue;
    try { client.send(data); } catch { session.clients.delete(id); }
  }
}

/** Aplica update do cliente, persiste cifrado e repassa aos outros. */
export function applyClientUpdate(session: LiveSession, update: Uint8Array, author: string, fromClientId: number): void {
  session.lastAuthor = author;
  Y.applyUpdate(session.doc, update, `client:${fromClientId}`);
  sheetStore.append(session.docId, update, author);
  broadcast(session, frame(FRAME_UPDATE, update), fromClientId);
  maybeCompact(session);
  scheduleIdleSave(session, author);
}

function maybeCompact(session: LiveSession): void {
  if (sheetStore.countUpdates(session.docId) < COMPACT_AFTER_UPDATES) return;
  const loaded = sheetStore.load(session.docId);
  if (!loaded) return;
  sheetStore.compact(session.docId, Y.encodeStateAsUpdate(session.doc), loaded.seq);
}

/**
 * Repassa cursor/seleção. O clientId e o usuário são atribuídos AQUI, nunca
 * aceitos do payload — senão um cliente poderia se anunciar como outro.
 */
export function relayPresence(session: LiveSession, payload: Uint8Array, fromClientId: number): void {
  const client = session.clients.get(fromClientId);
  if (!client) return;
  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>; } catch { return; }
  const stamped = JSON.stringify({ ...body, clientId: fromClientId, user: client.user });
  session.presence.set(fromClientId, stamped);
  broadcast(session, frame(FRAME_PRESENCE, new TextEncoder().encode(stamped)), fromClientId);
}

function clearIdle(session: LiveSession): void {
  if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = null; }
}

export function scheduleIdleSave(session: LiveSession, user: string): void {
  clearIdle(session);
  session.idleTimer = setTimeout(() => { void flush(session, user); }, IDLE_SAVE_MS);
}

/**
 * Materializa agora. Serializa contra si mesma (`saving`) para nunca ter dois
 * PUTs concorrentes do mesmo arquivo, e revalida a permissão do autor antes de
 * escrever — revogação no meio da sessão não deve conseguir gravar.
 */
export async function flush(session: LiveSession, user: string): Promise<MaterializeResult | null> {
  clearIdle(session);
  if (session.saving || session.diverged) return null;
  if (!session.authorize(user)) {
    session.onEvent(session, { t: 'error', message: 'sem_permissao' });
    return null;
  }
  session.saving = true;
  try {
    const res = await materialize({
      doc: session.doc, bucketId: session.bucketId, key: session.key,
      user, expectedFingerprint: session.fingerprint, io: session.io,
    });
    if (res.status === 'saved') {
      session.fingerprint = res.fingerprint;
      sheetStore.markClean(session.docId, res.fingerprint);
      session.onEvent(session, { t: 'saved', changed: res.changed });
    } else if (res.status === 'diverged') {
      session.diverged = true;
      session.onEvent(session, { t: 'diverged' });
    } else {
      sheetStore.markClean(session.docId, session.fingerprint);
      session.onEvent(session, { t: 'unchanged' });
    }
    return res;
  } catch (e) {
    session.onEvent(session, { t: 'error', message: String((e as Error).message ?? e) });
    return null;
  } finally {
    session.saving = false;
  }
}

/** Só para testes: derruba tudo sem materializar. */
export function resetSessions(): void {
  for (const s of sessions.values()) { clearIdle(s); s.doc.destroy(); }
  sessions.clear();
}
