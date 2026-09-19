// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { bootTestEnv } from './test-env';
import * as Y from 'yjs';
import * as XLSX from 'xlsx';
import type { SheetIo } from './materialize';
import type { LiveSession, SessionClient, SessionEvent } from './session';

let S: typeof import('./session');
let ydoc: typeof import('./ydoc');
let sheetStore: typeof import('./store').sheetStore;

beforeAll(async () => {
  await bootTestEnv();
  S = await import('./session');
  ydoc = await import('./ydoc');
  ({ sheetStore } = await import('./store'));
});

beforeEach(() => { S.resetSessions(); });

afterAll(() => { S.resetSessions(); });

function xlsxOf(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'A');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

function fakeIo(initial: Uint8Array) {
  const state = { bytes: initial, writes: 0, fp: 'fp-0' };
  const io: SheetIo = {
    async fetchBytes() { return state.bytes; },
    async fingerprint() { return state.fp; },
    async writeBytes(_b, _k, bytes) { state.bytes = bytes; state.writes++; state.fp = `fp-${state.writes}`; },
  };
  return { io, state };
}

function fakeClient(id: number, user = 'ana') {
  const frames: Uint8Array[] = [];
  const closed: { code: number; reason: string }[] = [];
  const client: SessionClient = {
    id, user,
    send: (f) => { frames.push(f); },
    close: (code, reason) => { closed.push({ code, reason }); },
  };
  return { client, frames, closed };
}

const controls = (frames: Uint8Array[]) =>
  frames.filter((f) => f[0] === 3).map((f) => JSON.parse(new TextDecoder().decode(f.subarray(1))));

async function open(io: SheetIo, events: SessionEvent[] = [], authorize: (u: string) => boolean = () => true) {
  const key = `planilhas/${randomUUID()}.xlsx`;
  const session = await S.openSession({
    bucketId: 'c:b', key, io, authorize,
    onEvent: (_s: LiveSession, e: SessionEvent) => { events.push(e); },
  });
  return { session, key };
}

describe('openSession', () => {
  it('importa o arquivo no primeiro acesso e registra o doc', async () => {
    const { io } = fakeIo(xlsxOf([['a', 1]]));
    const { session } = await open(io);
    expect(ydoc.sheetNames(session.doc)).toEqual(['A']);
    expect(ydoc.cellCount(session.doc)).toBe(2);
    expect(sheetStore.find(session.docId)).not.toBeNull();
  });

  it('reaproveita a sessão já aberta do mesmo arquivo', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    const again = await S.openSession({ bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {} });
    expect(again).toBe(session);
  });

  it('reconstrói o doc do banco depois de o processo perder a memória', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    ydoc.setCell(session.doc, 'A', 5, 0, 'sobrevive');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(session.doc), 'ana', 1);

    S.resetSessions();
    const revived = await S.openSession({ bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {} });
    expect(ydoc.sheetMap(revived.doc, 'A').get('R5C0')?.v).toBe('sobrevive');
  });

  it('descarta doc limpo e reimporta quando o arquivo mudou fora', async () => {
    const { io, state } = fakeIo(xlsxOf([['antigo']]));
    const { key } = await open(io);
    S.resetSessions();

    state.bytes = xlsxOf([['novo']]);
    state.fp = 'fp-externo';
    const session = await S.openSession({ bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {} });

    expect(ydoc.sheetMap(session.doc, 'A').get('R0C0')?.v).toBe('novo');
    expect(session.diverged).toBe(false);
  });

  it('abre em modo divergente quando há edição não salva E o arquivo mudou fora', async () => {
    const { io, state } = fakeIo(xlsxOf([['antigo']]));
    const { session, key } = await open(io);
    ydoc.setCell(session.doc, 'A', 0, 0, 'minha edicao');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(session.doc), 'ana', 1);
    S.resetSessions();

    state.bytes = xlsxOf([['de outro']]);
    state.fp = 'fp-externo';
    const revived = await S.openSession({ bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {} });

    expect(revived.diverged).toBe(true);
    expect(ydoc.sheetMap(revived.doc, 'A').get('R0C0')?.v).toBe('minha edicao');
  });
});

describe('clientes e broadcast', () => {
  it('novo cliente recebe o estado e o ready com as abas', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    const a = fakeClient(1);
    S.attach(session, a.client);

    expect(a.frames[0]![0]).toBe(S.FRAME_UPDATE);
    const ready = controls(a.frames).find((m) => m.t === 'ready');
    expect(ready.sheets).toEqual(['A']);
    expect(ready.diverged).toBe(false);
  });

  it('update de um cliente chega nos outros, não nele mesmo', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    const a = fakeClient(1, 'ana');
    const b = fakeClient(2, 'bia');
    S.attach(session, a.client);
    S.attach(session, b.client);
    const countBefore = { a: a.frames.length, b: b.frames.length };

    const edit = new Y.Doc();
    Y.applyUpdate(edit, Y.encodeStateAsUpdate(session.doc));
    ydoc.setCell(edit, 'A', 0, 1, 'de ana');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(edit), 'ana', 1);

    expect(b.frames.length).toBeGreaterThan(countBefore.b);
    expect(b.frames[b.frames.length - 1]![0]).toBe(S.FRAME_UPDATE);
    expect(a.frames.length).toBe(countBefore.a);
    expect(ydoc.sheetMap(session.doc, 'A').get('R0C1')?.v).toBe('de ana');
  });

  it('presença é repassada aos outros clientes', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    const a = fakeClient(1);
    const b = fakeClient(2, 'bia');
    S.attach(session, a.client);
    S.attach(session, b.client);

    S.relayPresence(session, new TextEncoder().encode('{"row":0,"col":1}'), 1);
    const last = b.frames[b.frames.length - 1]!;
    expect(last[0]).toBe(S.FRAME_PRESENCE);
    expect(JSON.parse(new TextDecoder().decode(last.subarray(1)))).toEqual({
      row: 0, col: 1, clientId: 1, user: 'ana',
    });
  });

  it('presença não aceita identidade forjada no payload', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    S.attach(session, fakeClient(1, 'ana').client);
    const b = fakeClient(2, 'bia');
    S.attach(session, b.client);

    S.relayPresence(session, new TextEncoder().encode('{"user":"admin","clientId":99,"row":3,"col":3}'), 1);
    const msg = JSON.parse(new TextDecoder().decode(b.frames[b.frames.length - 1]!.subarray(1)));
    expect(msg.user).toBe('ana');
    expect(msg.clientId).toBe(1);
  });

  it('lista de peers é anunciada quando alguém entra', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    const a = fakeClient(1, 'ana');
    S.attach(session, a.client);
    S.attach(session, fakeClient(2, 'bia').client);

    const peers = controls(a.frames).filter((m) => m.t === 'peers').pop();
    expect(peers.peers.map((p: { user: string }) => p.user).sort()).toEqual(['ana', 'bia']);
  });

  it('persiste cada update cifrado, permitindo retomar', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    ydoc.setCell(session.doc, 'A', 1, 1, 'x');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(session.doc), 'ana', 1);
    expect(sheetStore.countUpdates(session.docId)).toBe(1);
  });
});

describe('flush', () => {
  it('materializa a edição no arquivo', async () => {
    const { io, state } = fakeIo(xlsxOf([['a', 1]]));
    const events: SessionEvent[] = [];
    const { session } = await open(io, events);
    ydoc.setCell(session.doc, 'A', 0, 1, 77);

    const res = await S.flush(session, 'ana');
    expect(res?.status).toBe('saved');
    expect(state.writes).toBe(1);
    expect(XLSX.read(state.bytes, { type: 'array' }).Sheets['A']!['B1']!.v).toBe(77);
    expect(events).toContainEqual({ t: 'saved', changed: 1 });
  });

  it('limpa o sujo do banco depois de salvar', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    ydoc.setCell(session.doc, 'A', 0, 0, 'z');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(session.doc), 'ana', 1);
    expect(sheetStore.find(session.docId)!.dirty).toBe(1);

    await S.flush(session, 'ana');
    expect(sheetStore.find(session.docId)!.dirty).toBe(0);
  });

  it('não escreve e marca divergente quando o arquivo mudou fora', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const events: SessionEvent[] = [];
    const { session } = await open(io, events);
    ydoc.setCell(session.doc, 'A', 0, 0, 'meu');
    state.fp = 'fp-de-outro';

    await S.flush(session, 'ana');
    expect(state.writes).toBe(0);
    expect(session.diverged).toBe(true);
    expect(events).toContainEqual({ t: 'diverged' });
  });

  it('sessão divergente não tenta mais escrever', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    session.diverged = true;
    ydoc.setCell(session.doc, 'A', 0, 0, 'x');
    expect(await S.flush(session, 'ana')).toBeNull();
    expect(state.writes).toBe(0);
  });

  it('recusa gravar de quem perdeu a permissão no meio da sessão', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const events: SessionEvent[] = [];
    const allowed = new Set(['ana']);
    const { session } = await open(io, events, (u) => allowed.has(u));
    ydoc.setCell(session.doc, 'A', 0, 0, 'x');

    allowed.delete('ana');
    expect(await S.flush(session, 'ana')).toBeNull();
    expect(state.writes).toBe(0);
    expect(events).toContainEqual({ t: 'error', message: 'sem_permissao' });
  });

  it('não duplica escrita quando dois flushes correm juntos', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    ydoc.setCell(session.doc, 'A', 0, 0, 'x');

    const [r1, r2] = await Promise.all([S.flush(session, 'ana'), S.flush(session, 'ana')]);
    expect(state.writes).toBe(1);
    expect([r1, r2].filter((r) => r === null)).toHaveLength(1);
  });

  it('reporta unchanged quando não há diferença', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const events: SessionEvent[] = [];
    const { session } = await open(io, events);
    await S.flush(session, 'ana');
    expect(state.writes).toBe(0);
    expect(events).toContainEqual({ t: 'unchanged' });
  });
});

describe('ciclo de vida', () => {
  it('saída do último cliente materializa e libera a sessão', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    const a = fakeClient(1);
    S.attach(session, a.client);
    ydoc.setCell(session.doc, 'A', 0, 0, 'final');

    S.detach(session, 1);
    await Bun.sleep(20);
    expect(state.writes).toBe(1);
    expect(S.findSession('c:b', key)).toBeNull();
  });

  it('materialização na saída grava em nome de quem editou por último', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    // authorize restrito: só passa 'ana'. Um autor fictício seria recusado aqui.
    const { session } = await open(io, [], (u) => u === 'ana');
    S.attach(session, fakeClient(1, 'ana').client);

    const edit = new Y.Doc();
    Y.applyUpdate(edit, Y.encodeStateAsUpdate(session.doc));
    ydoc.setCell(edit, 'A', 0, 0, 'da ana');
    S.applyClientUpdate(session, Y.encodeStateAsUpdate(edit), 'ana', 1);

    S.detach(session, 1);
    await Bun.sleep(20);
    expect(state.writes).toBe(1);
    expect(XLSX.read(state.bytes, { type: 'array' }).Sheets['A']!['A1']!.v).toBe('da ana');
  });

  it('duas aberturas simultâneas do mesmo arquivo devolvem a MESMA sessão', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const key = `planilhas/${randomUUID()}.xlsx`;
    const args = { bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {} };
    const [s1, s2] = await Promise.all([S.openSession(args), S.openSession(args)]);
    expect(s1).toBe(s2);
  });

  it('saída de um entre dois não materializa nem encerra', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    S.attach(session, fakeClient(1).client);
    S.attach(session, fakeClient(2, 'bia').client);
    ydoc.setCell(session.doc, 'A', 0, 0, 'x');

    S.detach(session, 1);
    await Bun.sleep(20);
    expect(state.writes).toBe(0);
    expect(S.findSession('c:b', key)).toBe(session);
  });

  it('hasSessionUnder acha sessão ativa por prefixo', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    S.attach(session, fakeClient(1).client);

    expect(S.hasSessionUnder('c:b', 'planilhas/')).toBe(true);
    expect(S.hasSessionUnder('c:b', key)).toBe(true);
    expect(S.hasSessionUnder('c:b', 'outra/')).toBe(false);
    expect(S.hasSessionUnder('c:outro', 'planilhas/')).toBe(false);
  });

  it('hasSessionUnder não casa com key vizinha de mesmo começo', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const session = await S.openSession({
      bucketId: 'c:b', key: 'relatorio.xlsx', io, authorize: () => true, onEvent: () => {},
    });
    S.attach(session, fakeClient(1).client);

    expect(S.hasSessionUnder('c:b', 'relatorio.xlsx')).toBe(true);
    expect(S.hasSessionUnder('c:b', 'relatorio')).toBe(false);
  });

  it('retireIfIdle some com a sessão que nunca recebeu cliente', async () => {
    const { io, state } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    expect(S.hasSessionUnder('c:b', key)).toBe(true);

    await S.retireIfIdle(session);

    expect(S.findSession('c:b', key)).toBeNull();
    expect(S.hasSessionUnder('c:b', key)).toBe(false);
    expect(state.writes).toBe(0);
  });

  it('o reaper derruba sessão sem cliente passada do TTL', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);

    S.reapStaleSessions(Date.now() + S.CLIENTLESS_TTL_MS - 1);
    expect(S.findSession('c:b', key)).toBe(session);

    S.reapStaleSessions(Date.now() + S.CLIENTLESS_TTL_MS + 1);
    expect(S.findSession('c:b', key)).toBeNull();
    expect(S.hasSessionUnder('c:b', key)).toBe(false);
  });

  it('o reaper não derruba sessão com cliente, por mais velha que seja', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    S.attach(session, fakeClient(1).client);

    S.reapStaleSessions(Date.now() + S.CLIENTLESS_TTL_MS * 100);

    expect(S.findSession('c:b', key)).toBe(session);
  });

  it('cliente que entra depois zera o relógio do reaper', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    S.attach(session, fakeClient(1).client);
    S.detach(session, 1);
    await Bun.sleep(20);
    expect(S.findSession('c:b', key)).toBeNull();

    const again = await S.openSession({
      bucketId: 'c:b', key, io, authorize: () => true, onEvent: () => {},
    });
    S.attach(again, fakeClient(2).client);
    S.reapStaleSessions(Date.now() + S.CLIENTLESS_TTL_MS + 1);

    expect(S.findSession('c:b', key)).toBe(again);
  });

  it('retireIfIdle não mexe na sessão que tem cliente', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session, key } = await open(io);
    S.attach(session, fakeClient(1).client);

    await S.retireIfIdle(session);

    expect(S.findSession('c:b', key)).toBe(session);
  });

  it('compacta o log de updates ao passar do limite', async () => {
    const { io } = fakeIo(xlsxOf([['a']]));
    const { session } = await open(io);
    for (let i = 0; i < S.COMPACT_AFTER_UPDATES + 1; i++) {
      const edit = new Y.Doc();
      Y.applyUpdate(edit, Y.encodeStateAsUpdate(session.doc));
      ydoc.setCell(edit, 'A', i, 0, i);
      S.applyClientUpdate(session, Y.encodeStateAsUpdate(edit), 'ana', 1);
    }
    expect(sheetStore.countUpdates(session.docId)).toBeLessThan(S.COMPACT_AFTER_UPDATES);
    expect(ydoc.sheetMap(session.doc, 'A').get('R200C0')?.v).toBe(200);
  });
});
