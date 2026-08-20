// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { unzipSync, zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { patchXlsx, resolveSheetParts, rewriteSheetData, type CellPatch } from './patch';
import type { CellValue } from './model';

const enc = new TextEncoder();
const dec = new TextDecoder();

const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2" spans="1:3" ht="22" customHeight="1"><c r="A2" s="4"><v>10</v></c><c r="B2"><f>A2*2</f><v>20</v></c><c r="C2" t="s"><v>2</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A5:B5"/></mergeCells><conditionalFormatting sqref="A2"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>5</formula></cfRule></conditionalFormatting></worksheet>`;

const SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>Nome</t></si><si><t>Valor</t></si><si><t>obs</t></si></sst>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/><sheet name="Resumo &amp; Total" sheetId="2" r:id="rId2"/></sheets></workbook>`;

const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

const OOXML = 'http://schemas.openxmlformats.org/officeDocument/2006';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="${SML}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SML}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${SML}.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${SML}.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="${SML}.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OOXML}/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

/** Workbook sintético com as partes "exóticas" que precisam sobreviver ao patch. */
function fixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc.encode(CONTENT_TYPES),
    '_rels/.rels': enc.encode(ROOT_RELS),
    'xl/workbook.xml': enc.encode(WORKBOOK),
    'xl/_rels/workbook.xml.rels': enc.encode(WB_RELS),
    'xl/sharedStrings.xml': enc.encode(SHARED),
    'xl/styles.xml': enc.encode(STYLES),
    'xl/worksheets/sheet1.xml': enc.encode(SHEET1),
    'xl/worksheets/sheet2.xml': enc.encode(SHEET2),
    'xl/charts/chart1.xml': enc.encode('<?xml version="1.0"?><chartSpace>grafico</chartSpace>'),
    'xl/pivotTables/pivotTable1.xml': enc.encode('<?xml version="1.0"?><pivotTableDefinition/>'),
    'xl/vbaProject.bin': new Uint8Array([1, 2, 3, 4, 5, 250, 251]),
    'xl/media/image1.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  });
}

/** Açúcar: valor puro vira { v }, e patch explícito passa direto. */
const changed = (entries: [string, CellValue | CellPatch][]) =>
  new Map<string, CellPatch>(entries.map(([ref, e]) => [
    ref,
    e !== null && typeof e === 'object' ? e : { v: e },
  ]));

describe('resolveSheetParts', () => {
  it('mapeia nome da aba para a parte XML, desescapando entidades', () => {
    const parts = resolveSheetParts(unzipSync(fixture()));
    expect(parts.get('Dados')).toBe('xl/worksheets/sheet1.xml');
    expect(parts.get('Resumo & Total')).toBe('xl/worksheets/sheet2.xml');
  });

  it('lança quando não há workbook.xml', () => {
    expect(() => resolveSheetParts({})).toThrow('xlsx_sem_workbook');
  });
});

describe('patchXlsx — preservação', () => {
  it('mantém conteúdo idêntico de toda parte não tocada', () => {
    const before = unzipSync(fixture());
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 42]]) }]));

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      if (name === 'xl/worksheets/sheet1.xml') continue;
      expect(after[name]).toEqual(before[name]!);
    }
  });

  it('preserva partes binárias byte-a-byte (macro e imagem)', () => {
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 1]]) }]));
    expect([...after['xl/vbaProject.bin']!]).toEqual([1, 2, 3, 4, 5, 250, 251]);
    expect([...after['xl/media/image1.png']!]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('preserva o que está fora de sheetData na aba alterada', () => {
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 7]]) }]));
    const xml = dec.decode(after['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('<mergeCell ref="A5:B5"/>');
    expect(xml).toContain('<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan">');
    expect(xml).toContain('<sheetView workbookViewId="0"/>');
  });

  it('mantém fórmula e estilo das células não tocadas', () => {
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 99]]) }]));
    const xml = dec.decode(after['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('<f>A2*2</f>');
    expect(xml).toContain('<c r="C2" t="s"><v>2</v></c>');
  });

  it('mantém o estilo da célula que foi alterada', () => {
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 99]]) }]));
    const xml = dec.decode(after['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('<c r="A2" s="4"><v>99</v></c>');
  });

  it('mantém atributos originais da linha (altura customizada)', () => {
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 5]]) }]));
    const xml = dec.decode(after['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('ht="22"');
    expect(xml).toContain('customHeight="1"');
  });
});

describe('patchXlsx — leitura pelo consumidor', () => {
  const read = (bytes: Uint8Array) => {
    const wb = XLSX.read(bytes, { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets['Dados']!, { header: 1, blankrows: false, defval: '' }) as CellValue[][];
  };

  it('número escrito é lido de volta como número', () => {
    const rows = read(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 42.5]]) }]));
    expect(rows[1]![0]).toBe(42.5);
  });

  it('texto escrito é lido de volta como texto, com escape de XML', () => {
    const rows = read(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['C3', 'a & b <c>']]) }]));
    expect(rows[2]![2]).toBe('a & b <c>');
  });

  it('booleano escrito é lido de volta como booleano', () => {
    const rows = read(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A3', true]]) }]));
    expect(rows[2]![0]).toBe(true);
  });

  it('células originais continuam legíveis (sharedStrings intacto)', () => {
    const rows = read(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 1]]) }]));
    expect(rows[0]![0]).toBe('Nome');
    expect(rows[0]![1]).toBe('Valor');
  });

  it('escrever em célula nova estende a planilha e a dimension', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['E9', 'longe']]) }]);
    const sheet = XLSX.read(out, { type: 'array' }).Sheets['Dados']!;
    expect(sheet['E9']!.v).toBe('longe');
    expect(sheet['!ref']).toBe('A1:E9');
  });

  it('null apaga a célula', () => {
    const rows = read(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', null]]) }]));
    expect(rows[1]![0]).toBe('');
  });

  it('escreve em aba vazia (sheetData self-closing)', () => {
    const out = patchXlsx(fixture(), [{ name: 'Resumo & Total', cells: changed([['A1', 'ok']]) }]);
    expect(XLSX.read(out, { type: 'array' }).Sheets['Resumo & Total']!['A1']!.v).toBe('ok');
  });

  it('aplica mudanças em duas abas na mesma passada', () => {
    const out = patchXlsx(fixture(), [
      { name: 'Dados', cells: changed([['A2', 3]]) },
      { name: 'Resumo & Total', cells: changed([['B2', 'x']]) },
    ]);
    const wb = XLSX.read(out, { type: 'array' });
    expect(wb.Sheets['Dados']!['A2']!.v).toBe(3);
    expect(wb.Sheets['Resumo & Total']!['B2']!.v).toBe('x');
  });
});

describe('patchXlsx — estilo', () => {
  const sheetXml = (bytes: Uint8Array) => dec.decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
  const stylesXml = (bytes: Uint8Array) => dec.decode(unzipSync(bytes)['xl/styles.xml']!);

  it('pintar célula com valor preserva o valor e troca só o s', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', { style: { bg: 'FFEB3B' } }]]) }]);
    const xml = sheetXml(out);
    expect(xml).toContain('<c s="5" r="A2"><v>10</v></c>');
    expect(stylesXml(out)).toContain('<fgColor rgb="FFFFEB3B"/>');
  });

  it('pintar célula com fórmula NÃO perde a fórmula', () => {
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['B2', { style: { bold: true } }]]) }]));
    expect(xml).toContain('<f>A2*2</f>');
    expect(xml).toContain('<v>20</v>');
    expect(/<c s="\d+" r="B2">/.test(xml)).toBe(true);
  });

  it('pintar célula VAZIA cria célula só com estilo (colorir linha em branco)', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A7', { style: { bg: '2196F3' } }]]) }]);
    expect(sheetXml(out)).toContain('<c r="A7" s="5"/>');
  });

  it('colorir uma linha inteira gera todas as células daquela linha', () => {
    const row = changed(['A', 'B', 'C', 'D'].map((c) => [`${c}9`, { style: { bg: 'FF0000' } }] as [string, CellPatch]));
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: row }]));
    for (const c of ['A9', 'B9', 'C9', 'D9']) expect(xml).toContain(`<c r="${c}" s="5"/>`);
    expect(xml).toContain('spans="1:4"');
  });

  it('style null tira o estilo e mantém o valor', () => {
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', { style: null }]]) }]));
    expect(xml).toContain('<c r="A2"><v>10</v></c>');
  });

  it('style null em célula vazia remove a célula', () => {
    const pintada = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A7', { style: { bg: 'FF0000' } }]]) }]);
    const limpa = patchXlsx(pintada, [{ name: 'Dados', cells: changed([['A7', { style: null }]]) }]);
    expect(sheetXml(limpa)).not.toContain('r="A7"');
  });

  it('valor e estilo juntos numa tacada', () => {
    const out = patchXlsx(fixture(), [{
      name: 'Dados',
      cells: changed([['D4', { v: 1234.5, style: { bg: '00FF00', bold: true, numFmt: '#,##0.00' } }]]),
    }]);
    expect(sheetXml(out)).toContain('<c r="D4" s="5"><v>1234.5</v></c>');
    const styles = stylesXml(out);
    expect(styles).toContain('<font><b/><sz val="11"/><name val="Calibri"/></font>');
    expect(styles).toContain('<fgColor rgb="FF00FF00"/>');
  });

  it('mesmo estilo em várias células reusa um único xf', () => {
    const many = changed(['A20', 'B20', 'C20'].map((r) => [r, { style: { bg: 'ABCDEF' } }] as [string, CellPatch]));
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: many }]);
    expect(stylesXml(out)).toContain('<cellXfs count="6">');
    expect(stylesXml(out).match(/<fgColor rgb="FFABCDEF"\/>/g)).toHaveLength(1);
  });

  it('styles.xml não muda quando nenhum estilo é aplicado', () => {
    const before = unzipSync(fixture())['xl/styles.xml']!;
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A2', 5]]) }]))['xl/styles.xml']!;
    expect(after).toEqual(before);
  });

  it('estilo importado (com xf) não cria entrada nova', () => {
    const before = unzipSync(fixture())['xl/styles.xml']!;
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['A1', { style: { xf: 4, numFmt: '0.00' } }]]) }]);
    expect(unzipSync(out)['xl/styles.xml']!).toEqual(before);
    expect(sheetXml(out)).toContain('<c s="4" r="A1" t="s">');
  });

  it('o Excel/SheetJS lê o formato aplicado', () => {
    const out = patchXlsx(fixture(), [{
      name: 'Dados', cells: changed([['E5', { v: 0.42, style: { numFmt: '0.00%' } }]]),
    }]);
    const sheet = XLSX.read(out, { type: 'array', cellNF: true, cellText: true }).Sheets['Dados']!;
    expect(sheet['E5']!.v).toBe(0.42);
    expect(sheet['E5']!.z).toBe('0.00%');
    expect(sheet['E5']!.w).toBe('42.00%');
  });
});

describe('patchXlsx — fórmulas', () => {
  const sheetXml = (bytes: Uint8Array) => dec.decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);

  it('escreve fórmula com o valor em cache', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['D5', { v: 30, f: 'A2*3' }]]) }]);
    expect(sheetXml(out)).toContain('<c r="D5"><f>A2*3</f><v>30</v></c>');
  });

  it('atualizar só o valor preserva a fórmula que já estava lá', () => {
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['B2', 99]]) }]));
    expect(xml).toContain('<f>A2*2</f>');
    expect(xml).toContain('<v>99</v>');
  });

  it('fórmula compartilhada é preservada com seus atributos', () => {
    const comShared = SHEET1.replace('<c r="B2"><f>A2*2</f><v>20</v></c>',
      '<c r="B2"><f t="shared" ref="B2:B9" si="3">A2*2</f><v>20</v></c>');
    const zip = unzipSync(fixture());
    zip['xl/worksheets/sheet1.xml'] = enc.encode(comShared);
    const base = zipSync(zip, { mtime: new Date('1980-06-01T12:00:00Z') });

    const xml = sheetXml(patchXlsx(base, [{ name: 'Dados', cells: changed([['B2', 42]]) }]));
    expect(xml).toContain('<f t="shared" ref="B2:B9" si="3">A2*2</f>');
    expect(xml).toContain('<v>42</v>');
  });

  it('f null remove a fórmula e deixa valor puro', () => {
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['B2', { v: 7, f: null }]]) }]));
    expect(xml).not.toContain('<f>A2*2</f>');
    expect(xml).toContain('<c r="B2"><v>7</v></c>');
  });

  it('fórmula com texto como resultado usa t="str"', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['E5', { v: 'ok', f: 'IF(1>0,"ok","nao")' }]]) }]);
    expect(sheetXml(out)).toContain('t="str"><f>IF(1&gt;0,&quot;ok&quot;,&quot;nao&quot;)</f><v>ok</v>');
  });

  it('pintar célula com fórmula mantém a fórmula e o valor', () => {
    const xml = sheetXml(patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['B2', { style: { bg: 'FFEB3B' } }]]) }]));
    expect(xml).toContain('<f>A2*2</f>');
    expect(xml).toContain('<v>20</v>');
  });

  it('resultado de erro vira célula de erro (t="e"), não texto', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['D7', { v: '#DIV/0!', f: 'A2/0' }]]) }]);
    const xml = sheetXml(out);
    expect(xml).toContain('t="e"><f>A2/0</f><v>#DIV/0!</v>');
    expect(xml).not.toContain('inlineStr"><is><t xml:space="preserve">#DIV/0!');
  });

  it('o SheetJS lê a fórmula escrita', () => {
    const out = patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['D6', { v: 12, f: 'SUM(A2:B2)' }]]) }]);
    const cell = XLSX.read(out, { type: 'array' }).Sheets['Dados']!['D6']!;
    expect(cell.f).toBe('SUM(A2:B2)');
    expect(cell.v).toBe(12);
  });
});

describe('patchXlsx — falhas', () => {
  it('lança em aba desconhecida, sem devolver zip', () => {
    expect(() => patchXlsx(fixture(), [{ name: 'Inexistente', cells: changed([['A1', 1]]) }]))
      .toThrow('aba_desconhecida:Inexistente');
  });

  it('lança em referência inválida', () => {
    expect(() => patchXlsx(fixture(), [{ name: 'Dados', cells: changed([['9Z', 1]]) }]))
      .toThrow('ref_invalida:9Z');
  });

  it('lança quando a aba não tem sheetData', () => {
    expect(() => rewriteSheetData('<worksheet></worksheet>', changed([['A1', 1]])))
      .toThrow('sheet_sem_sheetData');
  });

  it('patch vazio não altera nada', () => {
    const before = unzipSync(fixture());
    const after = unzipSync(patchXlsx(fixture(), [{ name: 'Dados', cells: new Map() }]));
    for (const name of Object.keys(before)) expect(after[name]).toEqual(before[name]!);
  });
});
