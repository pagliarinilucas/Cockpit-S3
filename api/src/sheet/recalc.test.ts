// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { recalc, valueOf } from './recalc';
import { cellKey, type Cell } from './model';

const TODAY = 46000;

/** Mapa a partir de "A1": valor ou "=fórmula". */
function sheet(entries: Record<string, number | string | null>): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const [ref, raw] of Object.entries(entries)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
    const key = cellKey(Number(m[2]) - 1, col - 1);
    if (typeof raw === 'string' && raw.startsWith('=')) out.set(key, { v: null, f: raw.slice(1) });
    else out.set(key, { v: raw });
  }
  return out;
}

const at = (result: { values: Map<string, unknown> }, ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return result.values.get(cellKey(Number(m[2]) - 1, col - 1));
};

describe('recalc', () => {
  it('planilha sem fórmula não gera nada', () => {
    const r = recalc(sheet({ A1: 1, A2: 2 }), TODAY);
    expect(r.values.size).toBe(0);
    expect(r.cycles.size).toBe(0);
  });

  it('calcula fórmula simples', () => {
    const r = recalc(sheet({ A1: 10, A2: 5, B1: '=A1+A2' }), TODAY);
    expect(at(r, 'B1')).toBe(15);
  });

  it('respeita a ordem das dependências em cadeia', () => {
    const r = recalc(sheet({ A1: 2, B1: '=A1*3', C1: '=B1+1', D1: '=C1*2' }), TODAY);
    expect(at(r, 'B1')).toBe(6);
    expect(at(r, 'C1')).toBe(7);
    expect(at(r, 'D1')).toBe(14);
  });

  it('ordem no mapa não importa (cadeia declarada ao contrário)', () => {
    const r = recalc(sheet({ D1: '=C1*2', C1: '=B1+1', B1: '=A1*3', A1: 2 }), TODAY);
    expect(at(r, 'D1')).toBe(14);
  });

  it('soma de faixa que contém fórmulas', () => {
    const r = recalc(sheet({ A1: 1, A2: '=A1+1', A3: '=A2+1', B1: '=SUM(A1:A3)' }), TODAY);
    expect(at(r, 'A3')).toBe(3);
    expect(at(r, 'B1')).toBe(6);
  });

  it('TODAY chega nas fórmulas', () => {
    const r = recalc(sheet({ A1: '=TODAY()-8' }), TODAY);
    expect(at(r, 'A1')).toBe(TODAY - 8);
  });

  it('erro se propaga para quem depende', () => {
    const r = recalc(sheet({ A1: 0, B1: '=1/A1', C1: '=B1+1' }), TODAY);
    expect(at(r, 'B1')).toBe('#DIV/0!');
    expect(at(r, 'C1')).toBe('#DIV/0!');
  });
});

describe('recalc — referência circular', () => {
  it('ciclo de duas células vira #CYCLE! em vez de travar', () => {
    const r = recalc(sheet({ A1: '=B1+1', B1: '=A1+1' }), TODAY);
    expect(at(r, 'A1')).toBe('#CYCLE!');
    expect(at(r, 'B1')).toBe('#CYCLE!');
    expect(r.cycles.size).toBe(2);
  });

  it('auto-referência também é ciclo', () => {
    const r = recalc(sheet({ A1: '=A1+1' }), TODAY);
    expect(at(r, 'A1')).toBe('#CYCLE!');
  });

  it('ciclo não contamina o resto da planilha', () => {
    const r = recalc(sheet({ A1: '=B1', B1: '=A1', C1: 5, D1: '=C1*2' }), TODAY);
    expect(at(r, 'D1')).toBe(10);
    expect(at(r, 'A1')).toBe('#CYCLE!');
  });

  it('ciclo de três células', () => {
    const r = recalc(sheet({ A1: '=B1', B1: '=C1', C1: '=A1' }), TODAY);
    expect(r.cycles.size).toBe(3);
  });
});

describe('recalc — escala', () => {
  it('cadeia de mil fórmulas calcula na ordem certa', () => {
    const entries: Record<string, number | string> = { A1: 1 };
    for (let i = 2; i <= 1000; i++) entries[`A${i}`] = `=A${i - 1}+1`;
    const r = recalc(sheet(entries), TODAY);
    expect(at(r, 'A1000')).toBe(1000);
  });

  it('fórmula com faixa de coluna inteira não estoura', () => {
    const r = recalc(sheet({ A1: 5, B1: '=SUM(A1:A100000)' }), TODAY);
    expect(at(r, 'B1')).toBe(5);
  });
});

describe('valueOf', () => {
  it('prefere o valor recalculado', () => {
    const computed = new Map<string, number>([['R0C0', 42]]);
    expect(valueOf({ v: 1, f: 'X' }, computed, 'R0C0')).toBe(42);
  });

  it('sem recálculo, usa o valor em cache', () => {
    expect(valueOf({ v: 7 }, new Map(), 'R0C0')).toBe(7);
    expect(valueOf(undefined, undefined, 'R0C0')).toBeNull();
  });
});
