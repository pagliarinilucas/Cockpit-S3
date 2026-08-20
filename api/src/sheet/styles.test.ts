// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { StyleWriter, parseStyles, resolveAll, resolveXf, styleKey, type CellStyle } from './styles';

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/></font><font><i/><u/><sz val="14"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEB3B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment horizontal="center"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

const MINIMAL = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

const table = () => parseStyles(STYLES);

describe('parseStyles / resolveXf', () => {
  it('lê os blocos e o formato customizado', () => {
    const t = table();
    expect(t.fonts.items).toHaveLength(3);
    expect(t.fills.items).toHaveLength(3);
    expect(t.cellXfs.items).toHaveLength(6);
    expect(t.numFmts.get(164)).toBe('"R$" #,##0.00');
  });

  it('resolve negrito e cor da fonte', () => {
    expect(resolveXf(table(), 1)).toEqual({ xf: 1, bold: true, fg: 'FF0000' });
  });

  it('resolve preenchimento sólido', () => {
    expect(resolveXf(table(), 2)).toEqual({ xf: 2, bg: 'FFEB3B' });
  });

  it('resolve formato customizado e embutido', () => {
    expect(resolveXf(table(), 3).numFmt).toBe('"R$" #,##0.00');
    expect(resolveXf(table(), 5).numFmt).toBe('#,##0.00');
  });

  it('resolve itálico, sublinhado, borda e alinhamento juntos', () => {
    expect(resolveXf(table(), 4)).toEqual({
      xf: 4, italic: true, underline: true, border: true, align: 'center',
    });
  });

  it('estilo padrão não carrega atributo nenhum', () => {
    expect(resolveXf(table(), 0)).toEqual({ xf: 0 });
  });

  it('índice inexistente devolve vazio em vez de lançar', () => {
    expect(resolveXf(table(), 99)).toEqual({});
  });

  it('resolveAll cobre todos os índices na ordem', () => {
    const all = resolveAll(table());
    expect(all).toHaveLength(6);
    expect(all[2]!.bg).toBe('FFEB3B');
  });

  it('ignora cor de tema, que não dá para resolver sem theme1.xml', () => {
    const t = parseStyles(STYLES.replace('<color rgb="FFFF0000"/>', '<color theme="4"/>'));
    expect(resolveXf(t, 1).fg).toBeUndefined();
    expect(resolveXf(t, 1).bold).toBe(true);
  });
});

describe('StyleWriter — reuso', () => {
  it('estilo importado sem alteração reusa o mesmo xf', () => {
    const w = new StyleWriter(table());
    expect(w.ensureXf({ xf: 2, bg: 'FFEB3B' })).toBe(2);
    expect(w.changed).toBe(false);
  });

  it('sem mudanças, o styles.xml sai idêntico', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ xf: 1, bold: true });
    expect(w.serialize()).toBe(STYLES);
  });

  it('reusa o formato embutido e o xf equivalente que já existe', () => {
    const w = new StyleWriter(table());
    const idx = w.ensureXf({ numFmt: '#,##0.00' });
    expect(idx).toBe(5);
    expect(w.changed).toBe(false);
    expect(w.serialize()).toBe(STYLES);
  });

  it('reusa o formato customizado que já existe', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ numFmt: '"R$" #,##0.00' });
    expect(w.serialize().match(/numFmtId="164"/g)?.length).toBe(2);
  });

  it('dois pedidos iguais devolvem o mesmo índice novo', () => {
    const w = new StyleWriter(table());
    const a = w.ensureXf({ bg: '00FF00' });
    const b = w.ensureXf({ bg: '00FF00' });
    expect(a).toBe(b);
    expect(w.serialize().match(/<fill>/g)?.length).toBe(4);
  });
});

describe('StyleWriter — append-only', () => {
  const parts = (xml: string, name: string, item: string) => {
    const block = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}>`).exec(xml)![0];
    return block.match(new RegExp(`<${item}\\b[^>]*?(?:/>|>[\\s\\S]*?</${item}>)`, 'g')) ?? [];
  };

  it('entradas antigas continuam nas MESMAS posições', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ bg: '2196F3', bold: true, border: true, numFmt: '0.000' });
    const out = w.serialize();

    const before = table();
    for (const [name, item, original] of [
      ['fonts', 'font', before.fonts.items],
      ['fills', 'fill', before.fills.items],
      ['borders', 'border', before.borders.items],
      ['cellXfs', 'xf', before.cellXfs.items],
    ] as const) {
      const after = parts(out, name, item);
      expect(after.slice(0, original.length)).toEqual(original);
    }
  });

  it('atualiza o count de cada bloco alterado', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ bg: '2196F3', bold: true });
    const out = w.serialize();
    expect(out).toContain('<fonts count="4">');
    expect(out).toContain('<fills count="4">');
    expect(out).toContain('<cellXfs count="7">');
    expect(out).toContain('<borders count="2">');
  });

  it('novo xf aponta para as entradas novas', () => {
    const w = new StyleWriter(table());
    const idx = w.ensureXf({ bg: '2196F3', bold: true, align: 'right' });
    const out = w.serialize();
    const xf = parts(out, 'cellXfs', 'xf')[idx]!;
    expect(xf).toContain('fontId="3"');
    expect(xf).toContain('fillId="3"');
    expect(xf).toContain('<alignment horizontal="right"/>');
    expect(out).toContain('<fgColor rgb="FF2196F3"/>');
  });

  it('herda tamanho e fonte da fonte base ao criar negrito', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ bold: true });
    expect(w.serialize()).toContain('<font><b/><sz val="11"/><name val="Calibri"/></font>');
  });

  it('formato customizado novo entra com id >= 164 e escapa o código', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ numFmt: '"R$" #,##0.00;[Red]-"R$" #,##0.00' });
    const out = w.serialize();
    expect(out).toContain('numFmtId="165"');
    expect(out).toContain('&quot;R$&quot;');
    expect(out).toContain('<numFmts count="2">');
  });

  it('cria o bloco numFmts quando o arquivo não tem, antes de fonts', () => {
    const w = new StyleWriter(parseStyles(MINIMAL));
    w.ensureXf({ numFmt: 'dd/mm/yyyy hh:mm' });
    const out = w.serialize();
    expect(out.indexOf('<numFmts')).toBeLessThan(out.indexOf('<fonts'));
    expect(out).toContain('numFmtId="164"');
  });

  it('reusa a borda fina que já existe em vez de criar outra', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ border: true });
    expect(w.serialize()).toContain('<borders count="2">');
  });
});

describe('StyleWriter — código de formato com $ e &', () => {
  /**
   * "R$" contém `$`, que em string de substituição do replace significa grupo
   * capturado — `$&` injetaria o XML casado dentro do formatCode. Moeda é o
   * formato mais usado, então isso quebrava justamente o caso comum.
   */
  it('formato de moeda sobrevive e volta idêntico na releitura', () => {
    const w = new StyleWriter(table());
    const code = '"R$" #,##0.00';
    const idx = w.ensureXf({ numFmt: code });
    const out = w.serialize();

    expect(out).not.toContain('<numFmts count="2"><numFmt numFmtId="1"');
    expect(resolveXf(parseStyles(out), idx).numFmt).toBe(code);
  });

  it('não injeta XML no formatCode', () => {
    const w = new StyleWriter(table());
    w.ensureXf({ numFmt: '"R$" #,##0.00' });
    const numFmts = /<numFmts\b[^>]*>[\s\S]*?<\/numFmts>/.exec(w.serialize())![0];
    expect(numFmts).not.toContain('<numFmt numFmtId="164" formatCode="&quot;R<');
    expect(numFmts).toContain('formatCode="&quot;R$&quot; #,##0.00"');
  });

  it('cria o bloco numFmts com moeda quando o arquivo não tinha', () => {
    const w = new StyleWriter(parseStyles(MINIMAL));
    const idx = w.ensureXf({ numFmt: '"R$" #,##0.00' });
    const out = w.serialize();
    expect(resolveXf(parseStyles(out), idx).numFmt).toBe('"R$" #,##0.00');
  });

  it('e comercial no formato também sobrevive', () => {
    const w = new StyleWriter(table());
    const idx = w.ensureXf({ numFmt: '#,##0" A&B"' });
    expect(resolveXf(parseStyles(w.serialize()), idx).numFmt).toBe('#,##0" A&B"');
  });

  it('formatos de dois pedidos diferentes convivem', () => {
    const w = new StyleWriter(table());
    const a = w.ensureXf({ numFmt: '"R$" #,##0.00' });
    const b = w.ensureXf({ numFmt: '"US$" #,##0.000' });
    const t = parseStyles(w.serialize());
    expect(resolveXf(t, a).numFmt).toBe('"R$" #,##0.00');
    expect(resolveXf(t, b).numFmt).toBe('"US$" #,##0.000');
  });
});

describe('styleKey', () => {
  it('mesmos atributos visuais colidem, mesmo com xf diferente', () => {
    const a: CellStyle = { xf: 3, bg: 'FF0000', bold: true };
    const b: CellStyle = { xf: 9, bg: 'FF0000', bold: true };
    expect(styleKey(a)).toBe(styleKey(b));
  });

  it('atributo diferente muda a chave', () => {
    expect(styleKey({ bg: 'FF0000' })).not.toBe(styleKey({ bg: '00FF00' }));
    expect(styleKey({ bold: true })).not.toBe(styleKey({ italic: true }));
  });
});
