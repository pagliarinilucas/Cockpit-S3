// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { patchXlsx, rewriteCols, rewriteSheetData } from './patch';
import { diffAgainstBase } from './materialize';
import { parseCols, parseRows, colWidthToPx, pointsToPx, pxToColWidth, pxToPoints } from './layout';
import { applyWorkbook, setColWidth, setRowHeight } from './ydoc';
import { parseWorkbook } from './import';
import type { CellPatch } from './patch';

const dec = new TextDecoder();

const sheetXmlOf = (bytes: Uint8Array, part = 'xl/worksheets/sheet1.xml') =>
  dec.decode(unzipSync(bytes)[part]!);

function xlsxOf(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Plan1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('conversão de unidades', () => {
  it('largura em pixels volta para caracteres', () => {
    expect(pxToColWidth(colWidthToPx(8.43))).toBeCloseTo(8.43, 1);
  });

  it('altura em pixels volta para pontos', () => {
    expect(pxToPoints(pointsToPx(15))).toBeCloseTo(15, 1);
  });

  it('mantém o valor legível no arquivo (2 casas)', () => {
    expect(pxToColWidth(120)).toBe(16.43);
    expect(pxToPoints(40)).toBe(30);
  });
});

describe('rewriteCols', () => {
  const withCols = (cols: string) =>
    `<worksheet><cols>${cols}</cols><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`;

  it('cria o bloco quando o arquivo não tem nenhum', () => {
    const xml = '<worksheet><sheetData/></worksheet>';
    const out = rewriteCols(xml, new Map([[2, 210]]));
    const cols = parseCols(out);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.from).toBe(2);
    expect(cols[0]!.to).toBe(2);
    expect(cols[0]!.width).toBe(colWidthToPx(pxToColWidth(210)));
  });

  it('preserva atributos da coluna que não são largura', () => {
    const out = rewriteCols(withCols('<col min="1" max="1" width="9" style="7" hidden="1"/>'), new Map([[0, 300]]));
    expect(out).toContain('style="7"');
    expect(out).toContain('hidden="1"');
    expect(out).toContain('customWidth="1"');
    expect(parseCols(out)[0]!.width).toBe(colWidthToPx(pxToColWidth(300)));
  });

  it('divide a faixa e mexe só na coluna arrastada', () => {
    const out = rewriteCols(withCols('<col min="1" max="5" width="9"/>'), new Map([[2, 250]]));
    const cols = parseCols(out);
    const byIndex = new Map<number, number | undefined>();
    for (const col of cols) for (let i = col.from; i <= col.to; i++) byIndex.set(i, col.width);

    expect(byIndex.get(2)).toBe(colWidthToPx(pxToColWidth(250)));
    for (const untouched of [0, 1, 3, 4]) expect(byIndex.get(untouched)).toBe(colWidthToPx(9));
  });

  it('reagrupa colunas vizinhas de mesmo tamanho numa faixa só', () => {
    const out = rewriteCols(withCols('<col min="1" max="3" width="9"/>'), new Map([[0, 250], [1, 250], [2, 250]]));
    expect(parseCols(out)).toHaveLength(1);
    expect(out.match(/<col\b/g)).toHaveLength(1);
  });

  it('sem larguras alteradas devolve o xml intacto', () => {
    const xml = withCols('<col min="1" max="3" width="9"/>');
    expect(rewriteCols(xml, new Map())).toBe(xml);
  });
});

describe('altura de linha no sheetData', () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';

  it('grava ht e customHeight na linha com célula', () => {
    const out = rewriteSheetData(xml, new Map<string, CellPatch>(), () => 0, new Map([[0, 40]]));
    expect(out).toContain(`ht="${pxToPoints(40)}"`);
    expect(out).toContain('customHeight="1"');
    expect(parseRows(out)[0]!.height).toBe(pointsToPx(pxToPoints(40)));
  });

  it('cria a linha só para guardar a altura quando ela está vazia', () => {
    const out = rewriteSheetData(xml, new Map<string, CellPatch>(), () => 0, new Map([[5, 44]]));
    const row = parseRows(out).find((r) => r.row === 5);
    expect(row?.height).toBe(pointsToPx(pxToPoints(44)));
    expect(out).toContain('<row r="6"');
  });

  it('substitui a altura anterior em vez de duplicar o atributo', () => {
    const tall = '<worksheet><sheetData><row r="1" ht="30" customHeight="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
    const out = rewriteSheetData(tall, new Map<string, CellPatch>(), () => 0, new Map([[0, 60]]));
    expect(out.match(/\bht="/g)).toHaveLength(1);
    expect(parseRows(out)[0]!.height).toBe(pointsToPx(pxToPoints(60)));
  });
});

describe('geometria no documento vivo', () => {
  const docOf = (base: Uint8Array) => {
    const doc = new Y.Doc();
    applyWorkbook(doc, parseWorkbook(base, 'x.xlsx'));
    return doc;
  };

  it('só o que foi arrastado entra no patch', () => {
    const base = xlsxOf([['a', 'b']]);
    const doc = docOf(base);
    setColWidth(doc, 'Plan1', 1, 260);

    const patches = diffAgainstBase(doc, base, 'x.xlsx');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.cells.size).toBe(0);
    expect([...patches[0]!.colWidths!.entries()]).toEqual([[1, 260]]);
    expect(patches[0]!.rowHeights!.size).toBe(0);
  });

  it('largura igual à do arquivo não gera patch', () => {
    const base = xlsxOf([['a']]);
    const withWidth = patchXlsx(base, [{ name: 'Plan1', cells: new Map(), colWidths: new Map([[0, 260]]) }]);
    const stored = parseWorkbook(withWidth, 'x.xlsx').sheets[0]!.layout!.cols[0]!.width!;

    const doc = docOf(withWidth);
    setColWidth(doc, 'Plan1', 0, stored);
    expect(diffAgainstBase(doc, withWidth, 'x.xlsx')).toHaveLength(0);
  });

  it('tamanho fora dos limites é aparado', () => {
    const doc = docOf(xlsxOf([['a']]));
    setColWidth(doc, 'Plan1', 0, 99_999);
    setRowHeight(doc, 'Plan1', 0, 1);
    const patches = diffAgainstBase(doc, xlsxOf([['a']]), 'x.xlsx');
    expect(patches[0]!.colWidths!.get(0)).toBe(1200);
    expect(patches[0]!.rowHeights!.get(0)).toBe(14);
  });
});

describe('round-trip pelo arquivo', () => {
  it('largura e altura sobrevivem à gravação e à releitura', () => {
    const base = xlsxOf([['nome muito comprido', 2], [3, 4]]);
    const out = patchXlsx(base, [{
      name: 'Plan1',
      cells: new Map(),
      colWidths: new Map([[0, 320]]),
      rowHeights: new Map([[1, 48]]),
    }]);

    const layout = parseWorkbook(out, 'x.xlsx').sheets[0]!.layout!;
    expect(layout.cols.find((c) => c.from === 0)!.width).toBe(colWidthToPx(pxToColWidth(320)));
    expect(layout.rows.find((r) => r.row === 1)!.height).toBe(pointsToPx(pxToPoints(48)));
  });

  it('o Excel enxerga a largura como customWidth na coluna certa', () => {
    const out = patchXlsx(xlsxOf([['a', 'b', 'c']]), [{
      name: 'Plan1',
      cells: new Map(),
      colWidths: new Map([[1, 200]]),
    }]);
    const xml = sheetXmlOf(out);
    expect(xml).toContain(`<col min="2" max="2" width="${pxToColWidth(200)}" customWidth="1"/>`);
  });

  it('redimensionar não perde valor, fórmula nem estilo das células', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[10, 20, null]]);
    ws['C1'] = { t: 'n', f: 'A1+B1', v: 30 };
    ws['!ref'] = 'A1:C1';
    XLSX.utils.book_append_sheet(wb, ws, 'Plan1');
    const base = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);

    const out = patchXlsx(base, [{ name: 'Plan1', cells: new Map(), colWidths: new Map([[0, 200]]) }]);
    const cells = parseWorkbook(out, 'x.xlsx').sheets[0]!.cells;
    expect(cells.get('R0C0')!.v).toBe(10);
    expect(cells.get('R0C2')!.f).toBe('A1+B1');
    expect(cells.get('R0C2')!.v).toBe(30);
  });

  it('só o sheet alterado é reescrito; as outras partes ficam idênticas', () => {
    const base = xlsxOf([['a']]);
    const out = patchXlsx(base, [{ name: 'Plan1', cells: new Map(), colWidths: new Map([[0, 200]]) }]);
    const before = unzipSync(base);
    const after = unzipSync(out);

    for (const part of Object.keys(before)) {
      if (part === 'xl/worksheets/sheet1.xml') continue;
      expect(dec.decode(after[part]!)).toBe(dec.decode(before[part]!));
    }
  });
});
