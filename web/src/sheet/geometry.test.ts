// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { Axis, colAxis, rowAxis } from './geometry';

describe('Axis — tamanho uniforme', () => {
  const axis = new Axis(10, 20);

  it('offset e size', () => {
    expect(axis.offset(0)).toBe(0);
    expect(axis.offset(3)).toBe(60);
    expect(axis.size(5)).toBe(20);
    expect(axis.total).toBe(200);
  });

  it('indexAt encontra o índice do pixel', () => {
    expect(axis.indexAt(0)).toBe(0);
    expect(axis.indexAt(19)).toBe(0);
    expect(axis.indexAt(20)).toBe(1);
    expect(axis.indexAt(199)).toBe(9);
  });

  it('extrapola além do fim com o tamanho padrão', () => {
    expect(axis.offset(12)).toBe(240);
    expect(axis.indexAt(240)).toBe(12);
  });

  it('pixel negativo cai no primeiro índice', () => {
    expect(axis.indexAt(-5)).toBe(0);
    expect(axis.offset(-3)).toBe(0);
  });
});

describe('Axis — tamanhos variáveis', () => {
  // 0:50, 1:20(padrão), 2:100, 3:20, 4:20
  const axis = new Axis(5, 20, new Map([[0, 50], [2, 100]]));

  it('offsets acumulam os tamanhos reais', () => {
    expect(axis.offset(0)).toBe(0);
    expect(axis.offset(1)).toBe(50);
    expect(axis.offset(2)).toBe(70);
    expect(axis.offset(3)).toBe(170);
    expect(axis.total).toBe(210);
  });

  it('size devolve o tamanho de cada um', () => {
    expect(axis.size(0)).toBe(50);
    expect(axis.size(1)).toBe(20);
    expect(axis.size(2)).toBe(100);
  });

  it('indexAt respeita as fronteiras irregulares', () => {
    expect(axis.indexAt(49)).toBe(0);
    expect(axis.indexAt(50)).toBe(1);
    expect(axis.indexAt(69)).toBe(1);
    expect(axis.indexAt(70)).toBe(2);
    expect(axis.indexAt(169)).toBe(2);
    expect(axis.indexAt(170)).toBe(3);
  });

  it('span soma uma faixa (mesclagem)', () => {
    expect(axis.span(0, 0)).toBe(50);
    expect(axis.span(0, 2)).toBe(170);
    expect(axis.span(1, 3)).toBe(140);
  });
});

describe('Axis — oculto', () => {
  const axis = new Axis(4, 20, new Map(), new Set([1]));

  it('índice oculto tem tamanho zero e não desloca', () => {
    expect(axis.size(1)).toBe(0);
    expect(axis.offset(1)).toBe(20);
    expect(axis.offset(2)).toBe(20);
    expect(axis.total).toBe(60);
  });

  it('indexAt pula o oculto', () => {
    expect(axis.indexAt(20)).toBe(2);
  });
});

describe('colAxis', () => {
  it('aplica largura por faixa de colunas', () => {
    const axis = colAxis(8, 100, [
      { from: 0, to: 0, width: 164 },
      { from: 5, to: 6, width: 105 },
    ]);
    expect(axis.size(0)).toBe(164);
    expect(axis.size(1)).toBe(100);
    expect(axis.size(5)).toBe(105);
    expect(axis.size(6)).toBe(105);
    expect(axis.size(7)).toBe(100);
  });

  it('faixa além da contagem não estoura', () => {
    const axis = colAxis(3, 100, [{ from: 0, to: 999, width: 50 }]);
    expect(axis.total).toBe(150);
  });

  it('coluna oculta', () => {
    const axis = colAxis(3, 100, [{ from: 1, to: 1, hidden: true }]);
    expect(axis.size(1)).toBe(0);
  });
});

describe('rowAxis', () => {
  it('aplica altura por linha', () => {
    const axis = rowAxis(5, 20, [{ row: 0, height: 50 }, { row: 1, height: 32 }]);
    expect(axis.size(0)).toBe(50);
    expect(axis.size(1)).toBe(32);
    expect(axis.size(2)).toBe(20);
    expect(axis.total).toBe(50 + 32 + 20 * 3);
  });

  it('linha fora da contagem é ignorada', () => {
    const axis = rowAxis(2, 20, [{ row: 99, height: 500 }]);
    expect(axis.total).toBe(40);
  });
});

describe('tamanho arrastado sobrepõe o do arquivo', () => {
  it('largura do doc vivo ganha da do arquivo', () => {
    const axis = colAxis(3, 100, [{ from: 0, to: 2, width: 60 }], new Map([[1, 240]]));
    expect(axis.size(0)).toBe(60);
    expect(axis.size(1)).toBe(240);
    expect(axis.size(2)).toBe(60);
  });

  it('altura do doc vivo ganha da do arquivo', () => {
    const axis = rowAxis(3, 20, [{ row: 1, height: 40 }], new Map([[1, 90]]));
    expect(axis.size(1)).toBe(90);
    expect(axis.total).toBe(20 + 90 + 20);
  });

  it('arrastar uma linha oculta do arquivo volta a mostrá-la', () => {
    const axis = rowAxis(2, 20, [{ row: 0, hidden: true }], new Map([[0, 30]]));
    expect(axis.size(0)).toBe(30);
  });

  it('índice fora da contagem é ignorado', () => {
    const axis = colAxis(2, 100, [], new Map([[9, 500]]));
    expect(axis.total).toBe(200);
  });
});

describe('Axis — planilha grande', () => {
  it('busca binária responde em planilha de 50 mil linhas', () => {
    const sizes = new Map<number, number>();
    for (let i = 0; i < 50_000; i += 3) sizes.set(i, 30);
    const axis = new Axis(50_000, 20, sizes);
    const middle = axis.offset(25_000);
    expect(axis.indexAt(middle)).toBe(25_000);
    expect(axis.indexAt(axis.total - 1)).toBe(49_999);
  });
});
