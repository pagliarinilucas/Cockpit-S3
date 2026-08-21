// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Modelo do cliente. Os tipos e o endereçamento vêm dos módulos compartilhados
 * com o servidor (`@sheet/*` = api/src/sheet), então não existe uma segunda
 * definição do que é uma célula ou de como se lê uma referência A1. Aqui ficam
 * só as decisões de interface: como interpretar o que o usuário digita e o que
 * mostrar na tela.
 */
import { formatValue } from './format';
import {
  cellKey, cellRef, colIndex, colName, parseCellKey, parseCellRef,
  clampColWidth, clampRowHeight, colWidthKey, parseGeometryKey, rowHeightKey,
  GEOMETRY_PREFIX, SHEET_ORDER, SHEET_PREFIX, STYLES,
  type Cell, type CellStyle, type CellValue,
} from '@sheet/model';
import { styleKey } from '@sheet/styles';

export {
  cellKey, cellRef, colIndex, colName, parseCellKey, parseCellRef,
  clampColWidth, clampRowHeight, colWidthKey, parseGeometryKey, rowHeightKey,
  GEOMETRY_PREFIX, SHEET_ORDER, SHEET_PREFIX, STYLES, styleKey,
};
export type { Cell, CellStyle, CellValue };

/**
 * Aplica uma alteração parcial sobre o estilo atual. O `xf` é descartado: o
 * visual resultante é novo e não corresponde mais ao estilo do arquivo.
 * Propriedade com `undefined` (ou false/'') na alteração é removida — é assim
 * que se desliga negrito ou se tira o preenchimento.
 */
export function mergeStyle(current: CellStyle, change: Partial<CellStyle>): CellStyle {
  const { xf: _drop, ...base } = current;
  const next: CellStyle = { ...base };
  for (const [k, v] of Object.entries(change) as [keyof CellStyle, unknown][]) {
    if (v === undefined || v === false || v === '') delete next[k];
    else Object.assign(next, { [k]: v });
  }
  return next;
}

/** Estilo vazio (sem nada aplicado) não precisa existir. */
export const isBlankStyle = (style: CellStyle): boolean => styleKey(style) === styleKey({});

/**
 * O que o usuário digitou vira número quando é número, na convenção pt-BR:
 * vírgula é decimal e ponto em grupos de 3 é milhar ("1.500" é mil e quinhentos,
 * não 1,5). Ponto isolado com 1 ou 2 casas continua sendo decimal, que é o que
 * quem cola dado em formato internacional espera.
 */
export function coerce(text: string): CellValue {
  const t = text.trim();
  if (t === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(t)) return Number(t);
  const upper = t.toUpperCase();
  if (upper === 'VERDADEIRO' || upper === 'TRUE') return true;
  if (upper === 'FALSO' || upper === 'FALSE') return false;
  return text;
}

/**
 * Texto exibido na célula. Prioridade para o `w` que o próprio Excel calculou —
 * é mais fiel que o nosso formatador; quando a formatação foi feita aqui (o `w`
 * é descartado nesse momento), formata pelo código do estilo.
 */
export function display(cell: Cell | undefined, style?: CellStyle): string {
  if (!cell) return '';
  if (cell.w) return cell.w;
  return formatValue(cell.v, style?.numFmt);
}

/**
 * Texto que aparece ao editar: a fórmula quando a célula é calculada, senão o
 * valor cru (nunca o formatado — editar "1.234,50" devolveria texto).
 */
export function editText(cell: Cell | undefined): string {
  if (!cell) return '';
  if (cell.f) return `=${cell.f}`;
  if (cell.v === null) return '';
  if (typeof cell.v === 'boolean') return cell.v ? 'VERDADEIRO' : 'FALSO';
  return String(cell.v);
}

/** O que o usuário digitou é fórmula? */
export const isFormulaInput = (text: string): boolean => text.trimStart().startsWith('=');

/** Fórmula sem o "=" e sem espaços na borda. */
export const formulaOf = (text: string): string => text.trim().replace(/^=/, '');

export const isSheetName = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'xlsx' || ext === 'xlsm' || ext === 'csv' || ext === 'tsv';
};
