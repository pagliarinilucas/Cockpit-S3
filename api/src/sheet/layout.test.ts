// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import {
  colWidthToPx, coveredBy, defaultStyleFor, mergeAt, parseCols, parseFrozen,
  parseHyperlinks, parseLayout, parseMerges, parseRows, parseValidations, pointsToPx,
  hyperlinkAt, inA1Range, optionsAt,
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

describe('parseHyperlinks', () => {
  const XML = `<worksheet><sheetData/><hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="abrir site"/><hyperlink ref="B2:B3" location="Plan2!A1" display="ir"/><hyperlink ref="C1" r:id="rId9"/></hyperlinks></worksheet>`;
  const RELS = `<Relationships><Relationship Id="rId1" Target="https://exemplo.com/a?b=1&amp;c=2" TargetMode="External"/></Relationships>`;

  it('resolve o destino externo pelo rels', () => {
    const links = parseHyperlinks(XML, RELS);
    expect(links[0]).toEqual({ ref: 'A1', target: 'https://exemplo.com/a?b=1&c=2', tooltip: 'abrir site' });
  });

  it('link interno vem como location', () => {
    expect(parseHyperlinks(XML, RELS)[1]).toEqual({ ref: 'B2:B3', location: 'Plan2!A1' });
  });

  it('r:id sem correspondência no rels não inventa destino', () => {
    expect(parseHyperlinks(XML, RELS)[2]).toEqual({ ref: 'C1' });
  });

  it('sem rels, ainda lê os links internos', () => {
    expect(parseHyperlinks(XML)).toHaveLength(3);
  });

  it('hyperlinkAt acha pela célula, inclusive em faixa', () => {
    const layout = parseLayout(XML, RELS);
    expect(hyperlinkAt(layout, 0, 0)?.target).toContain('exemplo.com');
    expect(hyperlinkAt(layout, 2, 1)?.location).toBe('Plan2!A1');
    expect(hyperlinkAt(layout, 9, 9)).toBeUndefined();
  });
});

describe('parseValidations', () => {
  const XML = `<worksheet><sheetData/><dataValidations count="2"><dataValidation type="list" allowBlank="1" sqref="D2:D50"><formula1>"Conciliado,Pendente,Divergente"</formula1></dataValidation><dataValidation type="list" sqref="E2:E10"><formula1>$Z$1:$Z$5</formula1></dataValidation><dataValidation type="decimal" operator="between" sqref="F2"><formula1>0</formula1><formula2>100</formula2></dataValidation></dataValidations></worksheet>`;

  it('lista literal vira opções', () => {
    const [list] = parseValidations(XML);
    expect(list!.type).toBe('list');
    expect(list!.options).toEqual(['Conciliado', 'Pendente', 'Divergente']);
    expect(list!.allowBlank).toBe(true);
  });

  it('lista que aponta para faixa guarda a origem, sem inventar opções', () => {
    const fromRange = parseValidations(XML)[1]!;
    expect(fromRange.options).toBeUndefined();
    expect(fromRange.source).toBe('$Z$1:$Z$5');
  });

  it('validação que não é lista também é lida', () => {
    expect(parseValidations(XML)[2]!.type).toBe('decimal');
  });

  it('optionsAt devolve as opções da célula', () => {
    const layout = parseLayout(XML);
    expect(optionsAt(layout, 1, 3)).toEqual(['Conciliado', 'Pendente', 'Divergente']);
    expect(optionsAt(layout, 49, 3)).toHaveLength(3);
    expect(optionsAt(layout, 50, 3)).toBeUndefined();
    expect(optionsAt(layout, 1, 4)).toBeUndefined();
  });
});

describe('autoFilter', () => {
  it('faixa do autofiltro é registrada', () => {
    const layout = parseLayout('<worksheet><sheetData/><autoFilter ref="A1:M51"/></worksheet>');
    expect(layout.autoFilter).toBe('A1:M51');
  });

  it('sem autofiltro fica ausente', () => {
    expect(parseLayout(SHEET).autoFilter).toBeUndefined();
  });
});

describe('inA1Range', () => {
  it('aceita $ e faixa invertida', () => {
    expect(inA1Range('$B$2:$D$4', 2, 2)).toBe(true);
    expect(inA1Range('D4:B2', 1, 1)).toBe(true);
    expect(inA1Range('B2', 1, 1)).toBe(true);
    expect(inA1Range('B2', 2, 1)).toBe(false);
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
