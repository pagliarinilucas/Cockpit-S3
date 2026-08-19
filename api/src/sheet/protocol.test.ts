// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { decodeFrame, toBytes } from './protocol';
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
