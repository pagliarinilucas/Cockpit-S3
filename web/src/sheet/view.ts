// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Planilha só para exibição, como a rota `/sheet-view` devolve. É o caminho de
 * quem tem apenas leitura: o servidor interpreta o arquivo e manda o modelo, o
 * cliente desenha com o mesmo grid do editor. O arquivo em si nunca desce, o
 * que faz isso valer também para view-only (que não pode baixar).
 */
import type { Cell, CellStyle } from './model';
import type { SheetLayout } from '@sheet/layout';
import type { CfRule } from '@sheet/conditional';

export interface SheetViewSheet {
  name: string;
  rows: number;
  cols: number;
  /** Célula por chave R{linha}C{coluna} — JSON não transporta Map. */
  cells: Record<string, Cell>;
  layout: SheetLayout | null;
  cf: CfRule[];
}

export interface SheetView {
  sheets: SheetViewSheet[];
  styles: Record<string, CellStyle>;
  dxfs: CellStyle[];
}

export const cellsOf = (sheet: SheetViewSheet): Map<string, Cell> =>
  new Map(Object.entries(sheet.cells));

export const stylesOf = (view: SheetView): Map<string, CellStyle> =>
  new Map(Object.entries(view.styles));
