// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import * as XLSX from 'xlsx';
import { newWorkbookBytes, parseWorkbook, serializeDelimited } from './import';
import { cellKey, type SheetData } from './model';

function xlsxOf(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('parseWorkbook', () => {
  it('lê valores mantendo tipo', () => {
    const wbd = parseWorkbook(xlsxOf({ A: [['nome', 10, true]] }), 'x.xlsx');
    const cells = wbd.sheets[0]!.cells;
    expect(cells.get(cellKey(0, 0))!.v).toBe('nome');
    expect(cells.get(cellKey(0, 1))!.v).toBe(10);
    expect(cells.get(cellKey(0, 2))!.v).toBe(true);
  });

  it('ignora células vazias e calcula dimensões', () => {
    const wbd = parseWorkbook(xlsxOf({ A: [['a', null, 'c'], [], [null, 'z']] }), 'x.xlsx');
    const sheet = wbd.sheets[0]!;
    expect(sheet.cells.has(cellKey(0, 1))).toBe(false);
    expect(sheet.cells.get(cellKey(2, 1))!.v).toBe('z');
    expect(sheet.rows).toBe(3);
    expect(sheet.cols).toBe(3);
  });

  it('lê múltiplas abas na ordem do workbook', () => {
    const wbd = parseWorkbook(xlsxOf({ Primeira: [['p']], Segunda: [['s']] }), 'x.xlsx');
    expect(wbd.sheetNames).toEqual(['Primeira', 'Segunda']);
    expect(wbd.sheets[1]!.cells.get(cellKey(0, 0))!.v).toBe('s');
  });

  it('guarda texto formatado quando difere do valor cru', () => {
    const ws = XLSX.utils.aoa_to_sheet([[1234.5]]);
    ws['A1']!.z = '#,##0.00';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'A');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    const cell = parseWorkbook(bytes, 'x.xlsx').sheets[0]!.cells.get(cellKey(0, 0))!;
    expect(cell.v).toBe(1234.5);
    expect(cell.w).toBe('1,234.50');
  });

  it('lê csv', () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n');
    const cells = parseWorkbook(bytes, 'x.csv').sheets[0]!.cells;
    expect(cells.get(cellKey(0, 0))!.v).toBe('a');
    expect(cells.get(cellKey(1, 1))!.v).toBe(2);
  });

  it('lê tsv com tab como separador', () => {
    const bytes = new TextEncoder().encode('a\tb\n1\t2\n');
    const cells = parseWorkbook(bytes, 'x.tsv').sheets[0]!.cells;
    expect(cells.get(cellKey(0, 1))!.v).toBe('b');
  });

  it('recusa planilha acima do teto de células', () => {
    const rows = Array.from({ length: 400 }, () => Array.from({ length: 800 }, (_, i) => i));
    expect(() => parseWorkbook(xlsxOf({ A: rows }), 'x.xlsx')).toThrow('planilha_grande');
  });
});

describe('newWorkbookBytes', () => {
  it('gera xlsx válido e vazio', () => {
    const wb = XLSX.read(newWorkbookBytes(), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Planilha1']);
    expect(parseWorkbook(newWorkbookBytes(), 'novo.xlsx').sheets[0]!.cells.size).toBe(0);
  });

  it('respeita o nome da aba', () => {
    expect(XLSX.read(newWorkbookBytes('Custos'), { type: 'array' }).SheetNames).toEqual(['Custos']);
  });
});

describe('serializeDelimited', () => {
  const sheet = (): SheetData => ({
    name: 'A',
    rows: 2,
    cols: 2,
    cells: new Map([
      [cellKey(0, 0), { v: 'a' }],
      [cellKey(0, 1), { v: 'b,c' }],
      [cellKey(1, 1), { v: 7 }],
    ]),
  });

  it('escreve csv com escape de separador', () => {
    const text = new TextDecoder().decode(serializeDelimited(sheet(), 'csv'));
    expect(text).toBe('a,"b,c"\n,7\n');
  });

  it('escreve tsv com tab', () => {
    const text = new TextDecoder().decode(serializeDelimited(sheet(), 'tsv'));
    expect(text.split('\n')[0]).toBe('a\tb,c');
  });

  it('round-trip csv preserva os valores', () => {
    const bytes = serializeDelimited(sheet(), 'csv');
    const cells = parseWorkbook(bytes, 'x.csv').sheets[0]!.cells;
    expect(cells.get(cellKey(0, 1))!.v).toBe('b,c');
    expect(cells.get(cellKey(1, 1))!.v).toBe(7);
  });
});
