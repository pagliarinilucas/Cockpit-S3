// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Eixo de tamanhos variáveis (larguras de coluna, alturas de linha).
 *
 * A virtualização do grid precisa responder duas coisas em tempo constante: em
 * que pixel começa a linha N, e que linha está no pixel P. Com tamanho fixo é
 * multiplicação e divisão; com tamanhos diferentes por linha/coluna — que é o
 * caso de qualquer planilha real — é preciso somar. Este eixo pré-soma uma vez
 * e responde por busca binária.
 */

export class Axis {
  /** offsets[i] = pixel onde o índice i começa; tem count+1 posições. */
  private readonly offsets: number[];

  constructor(
    readonly count: number,
    readonly defaultSize: number,
    sizes: Map<number, number> = new Map(),
    hidden: Set<number> = new Set(),
  ) {
    this.offsets = new Array(count + 1);
    this.offsets[0] = 0;
    for (let i = 0; i < count; i++) {
      const size = hidden.has(i) ? 0 : sizes.get(i) ?? defaultSize;
      this.offsets[i + 1] = this.offsets[i]! + size;
    }
  }

  /** Pixel inicial do índice. Fora da faixa, extrapola com o tamanho padrão. */
  offset(index: number): number {
    if (index <= 0) return 0;
    if (index >= this.count) return this.total + (index - this.count) * this.defaultSize;
    return this.offsets[index]!;
  }

  size(index: number): number {
    if (index < 0 || index >= this.count) return this.defaultSize;
    return this.offsets[index + 1]! - this.offsets[index]!;
  }

  get total(): number { return this.offsets[this.count]!; }

  /** Índice que contém o pixel, por busca binária. */
  indexAt(px: number): number {
    if (px <= 0) return 0;
    if (px >= this.total) return this.count + Math.floor((px - this.total) / this.defaultSize);
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.offsets[mid + 1]! <= px) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Soma dos tamanhos de `from` até `to` (inclusive) — usado por mesclagem. */
  span(from: number, to: number): number {
    return this.offset(to + 1) - this.offset(from);
  }
}

export interface AxisSpec {
  count: number;
  defaultSize: number;
  sizes: Map<number, number>;
  hidden: Set<number>;
}

/** Monta o eixo das colunas a partir das faixas do arquivo. */
export function colAxis(
  count: number,
  defaultWidth: number,
  cols: { from: number; to: number; width?: number; hidden?: boolean }[],
): Axis {
  const sizes = new Map<number, number>();
  const hidden = new Set<number>();
  for (const col of cols) {
    for (let i = col.from; i <= col.to && i < count; i++) {
      if (col.width !== undefined) sizes.set(i, col.width);
      if (col.hidden) hidden.add(i);
    }
  }
  return new Axis(count, defaultWidth, sizes, hidden);
}

export function rowAxis(
  count: number,
  defaultHeight: number,
  rows: { row: number; height?: number; hidden?: boolean }[],
): Axis {
  const sizes = new Map<number, number>();
  const hidden = new Set<number>();
  for (const row of rows) {
    if (row.row >= count) continue;
    if (row.height !== undefined) sizes.set(row.row, row.height);
    if (row.hidden) hidden.add(row.row);
  }
  return new Axis(count, defaultHeight, sizes, hidden);
}
