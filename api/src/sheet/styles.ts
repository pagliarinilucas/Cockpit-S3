// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Leitura e extensão do styles.xml. Toda célula do arquivo referencia estilo por
 * ÍNDICE (`s="4"`), então a regra desta camada é ser append-only: entradas
 * existentes de fonte, preenchimento, borda, formato e cellXfs nunca são
 * reescritas — só entram novas no fim. Alterar uma existente repintaria células
 * que o usuário nem tocou.
 */

import { parseTheme, themeColor, type ThemePalette } from './theme';

/** Uma aresta de borda: estilo do OOXML (thin, medium, dashed…) e cor. */
export interface BorderEdge {
  style: string;
  color?: string;
}

export interface CellStyle {
  /** Índice do xf original quando o estilo veio do arquivo; ausente = criado aqui. */
  xf?: number;
  bg?: string;        // RRGGBB do preenchimento
  fg?: string;        // RRGGBB da fonte
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;    // código de formato do Excel ("#,##0.00", "dd/mm/yyyy")
  border?: boolean;   // borda fina nos quatro lados (a que o editor aplica)
  /** Bordas do arquivo, lado por lado — só exibição, mais rica que `border`. */
  borders?: { top?: BorderEdge; right?: BorderEdge; bottom?: BorderEdge; left?: BorderEdge };
  fontName?: string;
  /** Tamanho em pontos, como o arquivo guarda. */
  fontSize?: number;
  /** Quebra o texto dentro da célula. */
  wrap?: boolean;
  vAlign?: 'top' | 'middle' | 'bottom';
  /** Recuo, em passos (cada um vale ~1 caractere). */
  indent?: number;
}

/** Formatos embutidos que o Excel não lista no numFmts (ECMA-376, §18.8.30). */
const BUILTIN_NUM_FMTS: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'dd/mm/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

const FIRST_CUSTOM_FMT_ID = 164;

interface Section {
  /** Conteúdo de cada item na ordem do arquivo, como XML cru. */
  items: string[];
  /** Bloco inteiro original (`<fonts …>…</fonts>`), ou null se ausente. */
  raw: string | null;
}

export interface StyleTable {
  xml: string;
  numFmts: Map<number, string>;
  fonts: Section;
  fills: Section;
  borders: Section;
  cellXfs: Section;
  /** Paleta do tema, para resolver `theme="N" tint="T"`. */
  palette: ThemePalette;
  /** Formatos diferenciais usados pela formatação condicional (`dxfId`). */
  dxfs: CellStyle[];
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Itens de primeiro nível de um bloco (`<font>…</font>` ou `<font/>`). */
function splitItems(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g');
  return block.match(re) ?? [];
}

function readSection(xml: string, name: string, item: string): Section {
  const block = new RegExp(`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}>)`).exec(xml);
  if (!block) return { items: [], raw: null };
  return { items: splitItems(block[0], item), raw: block[0] };
}

export function parseStyles(xml: string, palette: ThemePalette = parseTheme(null)): StyleTable {
  const numFmts = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = attr(m[0], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) numFmts.set(id, unescapeXml(code));
  }
  return {
    xml,
    numFmts,
    fonts: readSection(xml, 'fonts', 'font'),
    fills: readSection(xml, 'fills', 'fill'),
    borders: readSection(xml, 'borders', 'border'),
    cellXfs: readSection(xml, 'cellXfs', 'xf'),
    palette,
    dxfs: parseDxfs(xml, palette),
  };
}

/**
 * `<dxf>` é o formato "diferencial" que a formatação condicional aplica por
 * cima da célula. Diferente de um xf normal, o preenchimento vem em `bgColor`
 * (e não `fgColor`) — quirk do formato.
 */
function parseDxfs(xml: string, palette: ThemePalette): CellStyle[] {
  const block = /<dxfs\b[^>]*?(?:\/>|>[\s\S]*?<\/dxfs>)/.exec(xml);
  if (!block) return [];
  return splitItems(block[0], 'dxf').map((dxf) => {
    const style: CellStyle = {};
    const font = /<font>[\s\S]*?<\/font>/.exec(dxf)?.[0];
    if (font) {
      if (/<b\b[^>]*\/?>/.test(font)) style.bold = true;
      if (/<i\b[^>]*\/?>/.test(font)) style.italic = true;
      const fg = colorIn(font, 'color', palette);
      if (fg) style.fg = fg;
    }
    const fill = /<fill>[\s\S]*?<\/fill>/.exec(dxf)?.[0];
    if (fill) {
      const bg = colorIn(fill, 'bgColor', palette) ?? colorIn(fill, 'fgColor', palette);
      if (bg) style.bg = bg;
    }
    const numFmt = /<numFmt\b[^>]*\/>/.exec(dxf)?.[0];
    const code = numFmt ? attr(numFmt, 'formatCode') : undefined;
    if (code) style.numFmt = unescapeXml(code);
    return style;
  });
}

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : "'");
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));

/**
 * RRGGBB de um elemento de cor. Aceita `rgb="FFRRGGBB"`, `theme="N" tint="T"`
 * (resolvido pela paleta) e ignora `auto="1"` — automático significa "a cor
 * padrão do tema do leitor", que quem renderiza decide. `indexed` (paleta
 * legada do Excel 95) também fica de fora.
 */
function colorIn(itemXml: string, tag: string, palette: ThemePalette): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*/?>`).exec(itemXml);
  if (!m) return undefined;
  const tag0 = m[0];

  const rgb = attr(tag0, 'rgb');
  if (rgb) return (rgb.length === 8 ? rgb.slice(2) : rgb).toUpperCase();

  const theme = attr(tag0, 'theme');
  if (theme !== undefined) {
    const tint = Number(attr(tag0, 'tint') ?? '0');
    return themeColor(palette, Number(theme), Number.isFinite(tint) ? tint : 0) ?? undefined;
  }
  return undefined;
}

const colorOf = (itemXml: string, palette: ThemePalette, tag = 'color') =>
  colorIn(itemXml, tag, palette);

/** Estilo resolvido de um índice de cellXfs — o que o cliente precisa pra pintar. */
export function resolveXf(table: StyleTable, index: number): CellStyle {
  const xf = table.cellXfs.items[index];
  if (!xf) return {};
  const style: CellStyle = { xf: index };

  const fontId = Number(attr(xf, 'fontId') ?? '0');
  const font = table.fonts.items[fontId];
  if (font) {
    if (/<b\b[^>]*\/?>/.test(font)) style.bold = true;
    if (/<i\b[^>]*\/?>/.test(font)) style.italic = true;
    if (/<u\b[^>]*\/?>/.test(font)) style.underline = true;
    const fg = colorOf(font, table.palette);
    if (fg && fg !== '000000') style.fg = fg;
    // Fonte só entra no estilo quando difere da padrão da planilha: registrar a
    // padrão em toda célula incharia o documento e faria todo estilo parecer
    // "não vazio" — inclusive o xf 0.
    const base = table.fonts.items[0] ?? '';
    const name = /<name\b[^>]*\bval="([^"]*)"/.exec(font)?.[1];
    const baseName = /<name\b[^>]*\bval="([^"]*)"/.exec(base)?.[1];
    if (name && name !== baseName) style.fontName = name;

    const size = Number(/<sz\b[^>]*\bval="([^"]*)"/.exec(font)?.[1] ?? '');
    const baseSize = Number(/<sz\b[^>]*\bval="([^"]*)"/.exec(base)?.[1] ?? '');
    if (Number.isFinite(size) && size > 0 && size !== baseSize) style.fontSize = size;
  }

  const fillId = Number(attr(xf, 'fillId') ?? '0');
  const fill = table.fills.items[fillId];
  if (fill && /patternType="solid"/.test(fill)) {
    const bg = colorOf(fill, table.palette, 'fgColor');
    if (bg) style.bg = bg;
  }

  const borderId = Number(attr(xf, 'borderId') ?? '0');
  const border = table.borders.items[borderId];
  if (border) {
    const edges = readBorderEdges(border, table.palette);
    if (edges) {
      style.borders = edges;
      style.border = true;   // compatível com quem só olha "tem borda?"
    }
  }

  const numFmtId = Number(attr(xf, 'numFmtId') ?? '0');
  const code = table.numFmts.get(numFmtId) ?? BUILTIN_NUM_FMTS[numFmtId];
  if (code) style.numFmt = code;

  const align = /<alignment\b[^>]*\/?>/.exec(xf)?.[0];
  if (align) {
    const horizontal = attr(align, 'horizontal');
    if (horizontal === 'left' || horizontal === 'center' || horizontal === 'right') style.align = horizontal;
    const vertical = attr(align, 'vertical');
    if (vertical === 'top' || vertical === 'bottom') style.vAlign = vertical;
    else if (vertical === 'center') style.vAlign = 'middle';
    if (attr(align, 'wrapText') === '1') style.wrap = true;
    const indent = Number(attr(align, 'indent') ?? '');
    if (Number.isFinite(indent) && indent > 0) style.indent = indent;
  }

  return style;
}

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Bordas lado a lado; devolve null quando nenhum lado tem estilo. */
function readBorderEdges(borderXml: string, palette: ThemePalette): CellStyle['borders'] | null {
  const out: NonNullable<CellStyle['borders']> = {};
  let any = false;
  for (const side of BORDER_SIDES) {
    const block = new RegExp(`<${side}\\b[^>]*?(?:/>|>[\\s\\S]*?</${side}>)`).exec(borderXml)?.[0];
    if (!block) continue;
    const style = attr(block, 'style');
    if (!style || style === 'none') continue;
    const color = colorIn(block, 'color', palette);
    out[side] = color ? { style, color } : { style };
    any = true;
  }
  return any ? out : null;
}

/** Todos os estilos do arquivo, por índice — usado na importação. */
export function resolveAll(table: StyleTable): CellStyle[] {
  return table.cellXfs.items.map((_, i) => resolveXf(table, i));
}

/**
 * Acrescenta o que faltar e devolve o índice de cellXfs para cada estilo pedido.
 * Nada existente é alterado; `serialize()` reemite o styles.xml com os apêndices.
 */
export class StyleWriter {
  private readonly fonts: string[];
  private readonly fills: string[];
  private readonly borders: string[];
  private readonly xfs: string[];
  private readonly numFmts: Map<number, string>;
  private readonly baseCounts: { fonts: number; fills: number; borders: number; xfs: number };
  private dirty = false;

  constructor(private readonly table: StyleTable) {
    this.fonts = [...table.fonts.items];
    this.fills = [...table.fills.items];
    this.borders = [...table.borders.items];
    this.xfs = [...table.cellXfs.items];
    this.numFmts = new Map(table.numFmts);
    this.baseCounts = {
      fonts: this.fonts.length, fills: this.fills.length,
      borders: this.borders.length, xfs: this.xfs.length,
    };
  }

  /** Índice de cellXfs que representa `style`, criando entradas se preciso. */
  ensureXf(style: CellStyle): number {
    if (style.xf !== undefined && style.xf < this.baseCounts.xfs) return style.xf;

    const fontId = this.ensureFont(style);
    const fillId = this.ensureFill(style);
    const borderId = style.border ? this.ensureBorder() : 0;
    const numFmtId = this.ensureNumFmt(style.numFmt);

    const alignAttrs = [
      style.align ? ` horizontal="${style.align}"` : '',
      style.vAlign ? ` vertical="${style.vAlign === 'middle' ? 'center' : style.vAlign}"` : '',
      style.wrap ? ' wrapText="1"' : '',
      style.indent ? ` indent="${style.indent}"` : '',
    ].join('');
    const alignment = alignAttrs ? `<alignment${alignAttrs}/>` : '';
    const applies = [
      numFmtId ? ' applyNumberFormat="1"' : '',
      fontId ? ' applyFont="1"' : '',
      fillId ? ' applyFill="1"' : '',
      borderId ? ' applyBorder="1"' : '',
      alignment ? ' applyAlignment="1"' : '',
    ].join('');
    // Auto-fechado quando não há alignment: é a forma que o Excel escreve, e é o
    // que permite reconhecer um xf equivalente já presente em vez de duplicar.
    const head = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies}`;
    const xf = alignment ? `${head}>${alignment}</xf>` : `${head}/>`;

    const existing = this.xfs.indexOf(xf);
    if (existing >= 0) return existing;
    this.xfs.push(xf);
    this.dirty = true;
    return this.xfs.length - 1;
  }

  private ensureFont(style: CellStyle): number {
    const custom = style.bold || style.italic || style.underline || style.fg
      || style.fontName || style.fontSize;
    if (!custom) return 0;
    const base = this.fonts[0] ?? '<font><sz val="11"/><name val="Calibri"/></font>';
    // Tamanho e família vêm do estilo quando ele os traz (é o caso de uma
    // célula do arquivo que ganhou cor: a fonte dela precisa continuar igual).
    const size = style.fontSize
      ? `<sz val="${style.fontSize}"/>`
      : /<sz\b[^>]*\/>/.exec(base)?.[0] ?? '<sz val="11"/>';
    const name = style.fontName
      ? `<name val="${escapeXml(style.fontName)}"/>`
      : /<name\b[^>]*\/>/.exec(base)?.[0] ?? '<name val="Calibri"/>';
    const font = '<font>'
      + (style.bold ? '<b/>' : '')
      + (style.italic ? '<i/>' : '')
      + (style.underline ? '<u/>' : '')
      + size
      + (style.fg ? `<color rgb="FF${style.fg}"/>` : '')
      + name
      + '</font>';
    return this.push(this.fonts, font);
  }

  private ensureFill(style: CellStyle): number {
    if (!style.bg) return 0;
    const fill = `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.bg}"/><bgColor indexed="64"/></patternFill></fill>`;
    return this.push(this.fills, fill);
  }

  private ensureBorder(): number {
    const thin = '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>';
    return this.push(this.borders, thin);
  }

  private ensureNumFmt(code: string | undefined): number {
    if (!code) return 0;
    for (const [id, existing] of this.numFmts) if (existing === code) return id;
    for (const [id, builtin] of Object.entries(BUILTIN_NUM_FMTS)) if (builtin === code) return Number(id);
    let id = FIRST_CUSTOM_FMT_ID;
    while (this.numFmts.has(id)) id++;
    this.numFmts.set(id, code);
    this.dirty = true;
    return id;
  }

  private push(list: string[], item: string): number {
    const existing = list.indexOf(item);
    if (existing >= 0) return existing;
    list.push(item);
    this.dirty = true;
    return list.length - 1;
  }

  get changed(): boolean { return this.dirty; }

  /** styles.xml com os apêndices; sem mudanças, devolve o original intacto. */
  serialize(): string {
    if (!this.dirty) return this.table.xml;
    let xml = this.table.xml;
    xml = this.replaceSection(xml, 'fonts', 'font', this.fonts, this.table.fonts);
    xml = this.replaceSection(xml, 'fills', 'fill', this.fills, this.table.fills);
    xml = this.replaceSection(xml, 'borders', 'border', this.borders, this.table.borders);
    xml = this.replaceSection(xml, 'cellXfs', 'xf', this.xfs, this.table.cellXfs);
    return this.writeNumFmts(xml);
  }

  private replaceSection(xml: string, name: string, item: string, items: string[], section: Section): string {
    if (items.length === section.items.length) return xml;
    const block = `<${name} count="${items.length}">${items.join('')}</${name}>`;
    // Substituição por FUNÇÃO: o bloco pode conter "$" (ex.: formato "R$"), e em
    // string de substituição "$&" significaria o texto casado — injetando XML.
    if (section.raw) return xml.replace(section.raw, () => block);
    // Bloco ausente no original: entra antes de cellXfs (ordem do schema OOXML).
    const anchor = /<cellXfs\b/.exec(xml);
    if (!anchor) throw new Error('styles_sem_cellXfs');
    return xml.slice(0, anchor.index) + block + xml.slice(anchor.index);
  }

  private writeNumFmts(xml: string): string {
    if (this.numFmts.size === this.table.numFmts.size) return xml;
    const entries = [...this.numFmts.entries()].sort((a, b) => a[0] - b[0])
      .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('');
    const block = `<numFmts count="${this.numFmts.size}">${entries}</numFmts>`;
    const existing = /<numFmts\b[^>]*?(?:\/>|>[\s\S]*?<\/numFmts>)/.exec(xml);
    // Função, não string: código de formato com "$" (moeda) faria "$&" ser
    // interpretado como o texto casado e injetaria XML dentro do formatCode.
    if (existing) return xml.replace(existing[0], () => block);
    // numFmts é o PRIMEIRO filho de styleSheet no schema.
    const fonts = /<fonts\b/.exec(xml);
    if (fonts) return xml.slice(0, fonts.index) + block + xml.slice(fonts.index);
    const open = /<styleSheet\b[^>]*>/.exec(xml);
    if (!open) throw new Error('styles_sem_styleSheet');
    const at = open.index + open[0].length;
    return xml.slice(0, at) + block + xml.slice(at);
  }
}

/** Chave de deduplicação: dois estilos com os mesmos atributos visuais são um só. */
export function styleKey(style: CellStyle): string {
  return JSON.stringify([
    style.bg ?? '', style.fg ?? '', !!style.bold, !!style.italic,
    !!style.underline, style.align ?? '', style.numFmt ?? '', !!style.border,
    style.fontName ?? '', style.fontSize ?? 0, !!style.wrap,
    style.vAlign ?? '', style.indent ?? 0,
    style.borders ? JSON.stringify(style.borders) : '',
  ]);
}

export { BUILTIN_NUM_FMTS };
