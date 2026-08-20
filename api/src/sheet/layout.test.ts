// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import {
  colWidthToPx, coveredBy, defaultStyleFor, mergeAt, parseCols, parseFrozen,
  parseLayout, parseMerges, parseRows, pointsToPx,
} from './layout';

/** Recorte fiel do "Controle de Conciliação Bancária". */
const SHEET = `<worksheet><dimension ref="A1:O51"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="L51" sqref="L51"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/><cols><col min="1" max="1" width="22.7109375" style="1" customWidth="1"/><col min="5" max="5" width="11.5703125" style="2" customWidth="1"/><col min="6" max="7" width="14.28515625" style="2" customWidth="1"/><col min="13" max="13" width="39.140625" bestFit="1" customWidth="1"/><col min="15" max="15" width="9.140625" style="16"/></cols><sheetData><row r="1" spans="1:15" s="8" customFormat="1" ht="37.5"><c r="A1" t="s"><v>0</v></c></row><row r="2" spans="1:15" ht="24" customHeight="1"><c r="A2"/></row><row r="3" spans="1:15" ht="24" customHeight="1"/><row r="9" spans="1:15" hidden="1"/><row r="10" spans="1:15" s="4"/></sheetData><mergeCells count="3"><mergeCell ref="F1:L1"/><mergeCell ref="A2:A3"/><mergeCell ref="A15:A22"/></mergeCells></worksheet>`;

describe('conversão de unidades', () => {
  it('largura em caracteres vira pixel', () => {
    expect(colWidthToPx(22.7109375)).toBe(164);
    expect(colWidthToPx(9.140625)).toBe(69);
  });

  it('altura em pontos vira pixel', () => {
    expect(pointsToPx(15)).toBe(20);
    expect(pointsToPx(24)).toBe(32);
    expect(pointsToPx(37.5)).toBe(50);
  });
});

describe('parseMerges', () => {
  const merges = parseMerges(SHEET);

  it('lê todas as mesclagens', () => {
    expect(merges).toHaveLength(3);
  });

  it('converte para índices 0-based', () => {
    expect(merges[0]).toEqual({ top: 0, left: 5, bottom: 0, right: 11 });
    expect(merges[1]).toEqual({ top: 1, left: 0, bottom: 2, right: 0 });
    expect(merges[2]).toEqual({ top: 14, left: 0, bottom: 21, right: 0 });
  });

  it('mergeAt acha só a âncora', () => {
    expect(mergeAt(merges, 0, 5)).toBeDefined();
    expect(mergeAt(merges, 0, 6)).toBeUndefined();
  });

  it('coveredBy acha as cobertas e ignora a âncora', () => {
    expect(coveredBy(merges, 0, 6)).toBeDefined();
    expect(coveredBy(merges, 0, 11)).toBeDefined();
    expect(coveredBy(merges, 0, 5)).toBeUndefined();
    expect(coveredBy(merges, 0, 12)).toBeUndefined();
    expect(coveredBy(merges, 20, 0)).toBeDefined();
  });
});

describe('parseCols', () => {
  const cols = parseCols(SHEET);

  it('lê faixa, largura e estilo', () => {
    expect(cols[0]).toEqual({ from: 0, to: 0, width: 164, style: 1 });
  });

  it('faixa de várias colunas vira from..to', () => {
    const faixa = cols.find((c) => c.from === 5)!;
    expect(faixa.to).toBe(6);
    expect(faixa.width).toBe(105);
  });

  it('coluna sem estilo não inventa estilo', () => {
    expect(cols.find((c) => c.from === 12)!.style).toBeUndefined();
  });

  it('coluna com estilo e sem customWidth ainda entra', () => {
    expect(cols.find((c) => c.from === 14)).toEqual({ from: 14, to: 14, width: 69, style: 16 });
  });
});

describe('parseRows', () => {
  const rows = parseRows(SHEET);

  it('lê altura convertida', () => {
    expect(rows.find((r) => r.row === 0)!.height).toBe(50);
    expect(rows.find((r) => r.row === 1)!.height).toBe(32);
  });

  it('estilo da linha só conta com customFormat', () => {
    expect(rows.find((r) => r.row === 0)!.style).toBe(8);
    expect(rows.find((r) => r.row === 9)?.style).toBeUndefined();
  });

  it('linha oculta é marcada', () => {
    expect(rows.find((r) => r.row === 8)!.hidden).toBe(true);
  });

  it('linha sem nada de especial não entra na lista', () => {
    expect(rows.some((r) => r.row === 3)).toBe(false);
  });
});

describe('parseFrozen', () => {
  it('sem pane, nada congelado', () => {
    expect(parseFrozen(SHEET)).toEqual({ frozenRows: 0, frozenCols: 0 });
  });

  it('lê o painel congelado', () => {
    const xml = '<sheetView><pane xSplit="1" ySplit="2" topLeftCell="B3" state="frozen"/></sheetView>';
    expect(parseFrozen(xml)).toEqual({ frozenRows: 2, frozenCols: 1 });
  });

  it('split sem congelar não conta', () => {
    const xml = '<sheetView><pane xSplit="1000" ySplit="500" state="split"/></sheetView>';
    expect(parseFrozen(xml)).toEqual({ frozenRows: 0, frozenCols: 0 });
  });
});

describe('parseLayout', () => {
  const layout = parseLayout(SHEET);

  it('junta tudo e converte a altura padrão', () => {
    expect(layout.merges).toHaveLength(3);
    expect(layout.cols).toHaveLength(5);
    expect(layout.defaultRowHeight).toBe(20);
  });

  it('sem sheetFormatPr assume 15pt', () => {
    expect(parseLayout('<worksheet><sheetData/></worksheet>').defaultRowHeight).toBe(20);
  });
});

describe('defaultStyleFor', () => {
  const layout = parseLayout(SHEET);

  it('estilo da linha ganha do da coluna', () => {
    expect(defaultStyleFor(layout, 0, 0)).toBe(8);
  });

  it('sem estilo de linha, usa o da coluna', () => {
    expect(defaultStyleFor(layout, 5, 0)).toBe(1);
    expect(defaultStyleFor(layout, 5, 6)).toBe(2);
  });

  it('coluna sem estilo devolve undefined', () => {
    expect(defaultStyleFor(layout, 5, 12)).toBeUndefined();
  });
});
