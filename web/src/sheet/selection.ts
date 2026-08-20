// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Modelo de seleção do grid: uma ou mais faixas retangulares, possivelmente
 * soltas (Ctrl+clique). Fica fora do componente para poder ser testado sem DOM —
 * é a lógica que decide o que uma formatação vai atingir.
 */

export interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface Cursor { row: number; col: number }

/** Faixa normalizada entre âncora e cursor (a âncora pode estar depois). */
export const rangeOf = (anchor: Cursor, cursor: Cursor): Range => ({
  top: Math.min(anchor.row, cursor.row),
  left: Math.min(anchor.col, cursor.col),
  bottom: Math.max(anchor.row, cursor.row),
  right: Math.max(anchor.col, cursor.col),
});

export const contains = (ranges: Range[], row: number, col: number): boolean =>
  ranges.some((r) => row >= r.top && row <= r.bottom && col >= r.left && col <= r.right);

/** A linha é tocada por alguma faixa? (acende o cabeçalho) */
export const rowTouched = (ranges: Range[], row: number): boolean =>
  ranges.some((r) => row >= r.top && row <= r.bottom);

export const colTouched = (ranges: Range[], col: number): boolean =>
  ranges.some((r) => col >= r.left && col <= r.right);

/** É uma seleção de mais de uma célula? */
export const isMulti = (ranges: Range[]): boolean =>
  ranges.length > 1 || ranges.some((r) => r.top !== r.bottom || r.left !== r.right);

/**
 * Células das faixas, sem repetir as que aparecem em mais de uma. A ordem é
 * estável (linha, depois coluna) para o resultado de uma formatação não depender
 * da ordem em que o usuário clicou.
 */
export function cellsOf(ranges: Range[]): Cursor[] {
  const seen = new Set<string>();
  const out: Cursor[] = [];
  for (const r of ranges) {
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        const k = `${row}:${col}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ row, col });
      }
    }
  }
  return out.sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

/** Quantidade de células selecionadas, contando sobreposição uma vez só. */
export const countCells = (ranges: Range[]): number => cellsOf(ranges).length;

/** Faixa que cobre a linha inteira até a largura em uso. */
export const wholeRow = (row: number, cols: number): Range =>
  ({ top: row, left: 0, bottom: row, right: Math.max(cols - 1, 11) });

export const wholeCol = (col: number, rows: number): Range =>
  ({ top: 0, left: col, bottom: Math.max(rows - 1, 29), right: col });
