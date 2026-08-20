// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import {
  cellsOf, colTouched, contains, countCells, isMulti, rangeOf, rowTouched,
  wholeCol, wholeRow, type Range,
} from './selection';

describe('rangeOf', () => {
  it('normaliza quando a âncora está depois do cursor', () => {
    expect(rangeOf({ row: 5, col: 3 }, { row: 2, col: 1 }))
      .toEqual({ top: 2, left: 1, bottom: 5, right: 3 });
  });

  it('célula única vira faixa de tamanho 1', () => {
    expect(rangeOf({ row: 4, col: 4 }, { row: 4, col: 4 }))
      .toEqual({ top: 4, left: 4, bottom: 4, right: 4 });
  });
});

describe('contains', () => {
  const ranges: Range[] = [
    { top: 0, left: 0, bottom: 2, right: 2 },
    { top: 10, left: 5, bottom: 10, right: 8 },
  ];

  it('acha em qualquer uma das faixas', () => {
    expect(contains(ranges, 1, 1)).toBe(true);
    expect(contains(ranges, 10, 7)).toBe(true);
  });

  it('fora de todas devolve falso', () => {
    expect(contains(ranges, 5, 5)).toBe(false);
    expect(contains(ranges, 10, 9)).toBe(false);
  });

  it('lista vazia não contém nada', () => {
    expect(contains([], 0, 0)).toBe(false);
  });
});

describe('rowTouched e colTouched', () => {
  const ranges: Range[] = [
    { top: 3, left: 0, bottom: 5, right: 1 },
    { top: 9, left: 7, bottom: 9, right: 7 },
  ];

  it('linha tocada por qualquer faixa', () => {
    expect(rowTouched(ranges, 4)).toBe(true);
    expect(rowTouched(ranges, 9)).toBe(true);
    expect(rowTouched(ranges, 6)).toBe(false);
  });

  it('coluna tocada por qualquer faixa', () => {
    expect(colTouched(ranges, 1)).toBe(true);
    expect(colTouched(ranges, 7)).toBe(true);
    expect(colTouched(ranges, 4)).toBe(false);
  });
});

describe('isMulti', () => {
  it('uma célula só não é seleção múltipla', () => {
    expect(isMulti([{ top: 1, left: 1, bottom: 1, right: 1 }])).toBe(false);
  });

  it('faixa maior é múltipla', () => {
    expect(isMulti([{ top: 1, left: 1, bottom: 3, right: 1 }])).toBe(true);
  });

  it('duas células soltas são múltiplas', () => {
    expect(isMulti([
      { top: 1, left: 1, bottom: 1, right: 1 },
      { top: 5, left: 5, bottom: 5, right: 5 },
    ])).toBe(true);
  });
});

describe('cellsOf', () => {
  it('expande a faixa em células', () => {
    expect(cellsOf([{ top: 0, left: 0, bottom: 1, right: 1 }])).toEqual([
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 },
    ]);
  });

  it('não repete célula que está em duas faixas', () => {
    const ranges: Range[] = [
      { top: 0, left: 0, bottom: 1, right: 1 },
      { top: 1, left: 1, bottom: 2, right: 2 },
    ];
    expect(countCells(ranges)).toBe(7);
    expect(cellsOf(ranges).filter((c) => c.row === 1 && c.col === 1)).toHaveLength(1);
  });

  it('ordem é estável, independente da ordem dos cliques', () => {
    const a: Range[] = [{ top: 5, left: 0, bottom: 5, right: 0 }, { top: 1, left: 0, bottom: 1, right: 0 }];
    const b: Range[] = [{ top: 1, left: 0, bottom: 1, right: 0 }, { top: 5, left: 0, bottom: 5, right: 0 }];
    expect(cellsOf(a)).toEqual(cellsOf(b));
  });

  it('seleção vazia devolve lista vazia', () => {
    expect(cellsOf([])).toEqual([]);
  });
});

describe('wholeRow e wholeCol', () => {
  it('linha cobre a largura em uso, com mínimo de 12 colunas', () => {
    expect(wholeRow(3, 20)).toEqual({ top: 3, left: 0, bottom: 3, right: 19 });
    expect(wholeRow(3, 2)).toEqual({ top: 3, left: 0, bottom: 3, right: 11 });
  });

  it('coluna cobre a altura em uso, com mínimo de 30 linhas', () => {
    expect(wholeCol(2, 100)).toEqual({ top: 0, left: 2, bottom: 99, right: 2 });
    expect(wholeCol(2, 5)).toEqual({ top: 0, left: 2, bottom: 29, right: 2 });
  });

  it('duas linhas soltas viram duas faixas com o total certo de células', () => {
    const ranges = [wholeRow(1, 4), wholeRow(7, 4)];
    expect(countCells(ranges)).toBe(24);
  });
});
