// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { binarySend, decodeFrame, toBytes } from './protocol';
import { FRAME_CONTROL, FRAME_PRESENCE, FRAME_UPDATE, frame } from './session';

const enc = (s: string) => new TextEncoder().encode(s);

describe('toBytes', () => {
  it('aceita Uint8Array', () => {
    expect([...toBytes(new Uint8Array([1, 2]))!]).toEqual([1, 2]);
  });

  it('aceita ArrayBuffer', () => {
    expect([...toBytes(new Uint8Array([3, 4]).buffer)!]).toEqual([3, 4]);
  });

  it('aceita Buffer do node', () => {
    expect([...toBytes(Buffer.from([5, 6]))!]).toEqual([5, 6]);
  });

  it('aceita view com offset sem embaralhar os bytes', () => {
    const base = new Uint8Array([9, 9, 7, 8]);
    expect([...toBytes(new Uint8Array(base.buffer, 2, 2))!]).toEqual([7, 8]);
  });

  it('aceita string', () => {
    expect([...toBytes('ab')!]).toEqual([97, 98]);
  });

  it('recusa o resto', () => {
    expect(toBytes(null)).toBeNull();
    expect(toBytes(42)).toBeNull();
    expect(toBytes({ t: 'save' })).toBeNull();
  });
});

describe('binarySend', () => {
  /** O wrapper do Elysia serializa Uint8Array como JSON; o socket cru, não. */
  function fakeWs() {
    const viaWrapper: unknown[] = [];
    const viaRaw: Uint8Array[] = [];
    const ws = {
      send: (d: unknown) => { viaWrapper.push(d); },
      raw: { send: (d: Uint8Array) => { viaRaw.push(d); } },
    };
    return { ws, viaWrapper, viaRaw };
  }

  it('manda pelo socket cru, nunca pelo wrapper que faria JSON do binário', () => {
    const { ws, viaWrapper, viaRaw } = fakeWs();
    binarySend(ws)(new Uint8Array([1, 2, 3]));
    expect(viaWrapper).toHaveLength(0);
    expect(viaRaw).toHaveLength(1);
  });

  it('entrega exatamente os bytes recebidos', () => {
    const { ws, viaRaw } = fakeWs();
    const frame = new Uint8Array([FRAME_UPDATE, 200, 0, 42]);
    binarySend(ws)(frame);
    expect([...viaRaw[0]!]).toEqual([FRAME_UPDATE, 200, 0, 42]);
    expect(typeof viaRaw[0]).toBe('object');
  });
});

describe('decodeFrame', () => {
  it('reconhece update e devolve só o payload', () => {
    const action = decodeFrame(frame(FRAME_UPDATE, new Uint8Array([10, 11])));
    expect(action.kind).toBe('update');
    expect(action.kind === 'update' && [...action.payload]).toEqual([10, 11]);
  });

  it('reconhece presença', () => {
    const action = decodeFrame(frame(FRAME_PRESENCE, enc('{"row":1,"col":2}')));
    expect(action.kind).toBe('presence');
  });

  it('reconhece pedido de salvar', () => {
    expect(decodeFrame(frame(FRAME_CONTROL, enc('{"t":"save"}'))).kind).toBe('save');
  });

  it('ignora controle desconhecido', () => {
    expect(decodeFrame(frame(FRAME_CONTROL, enc('{"t":"apagar-tudo"}'))).kind).toBe('ignore');
  });

  it('ignora controle com JSON inválido em vez de lançar', () => {
    expect(decodeFrame(frame(FRAME_CONTROL, enc('{quebrado'))).kind).toBe('ignore');
  });

  it('ignora frame vazio, de 1 byte e de tipo desconhecido', () => {
    expect(decodeFrame(new Uint8Array([])).kind).toBe('ignore');
    expect(decodeFrame(new Uint8Array([FRAME_UPDATE])).kind).toBe('ignore');
    expect(decodeFrame(new Uint8Array([99, 1, 2])).kind).toBe('ignore');
  });

  it('ignora lixo que não é bytes', () => {
    expect(decodeFrame(undefined).kind).toBe('ignore');
  });
});
