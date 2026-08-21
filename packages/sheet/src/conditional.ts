// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Formatação condicional: leitura das regras e avaliação por célula.
 *
 * Duas famílias importam na prática: `cellIs` (compara o valor da célula com
 * um limite) e `expression` (uma fórmula que devolve verdadeiro/falso). As
 * fórmulas de `expression` são escritas para a PRIMEIRA célula da faixa e
 * valem para as outras por referência relativa — `M2<=TODAY()-8` aplicado em
 * M7 significa `M7<=TODAY()-8`. É isso que este módulo desloca.
 *
 * A ordem importa: vence a regra de menor `priority` entre as que casam, e
 * `stopIfTrue` interrompe a avaliação das seguintes.
 */
import { cellKey, parseCellRef, type Cell, type CellValue } from './model';
import type { CellStyle } from './styles';
import { parseTheme, themeColor, type ThemePalette } from './theme';

export type CfOperator =
  | 'greaterThan' | 'lessThan' | 'equal' | 'notEqual'
  | 'greaterThanOrEqual' | 'lessThanOrEqual' | 'between' | 'notBetween'
  | 'containsText' | 'notContains' | 'beginsWith' | 'endsWith';

export type CfType =
  | 'cellIs' | 'expression' | 'containsText' | 'notContainsText'
  | 'dataBar' | 'colorScale' | 'iconSet' | 'unsupported';

/** Ponto de referência de barra/escala: mínimo, máximo, número, percentil… */
export interface Cfvo {
  type: string;
  val?: string;
}

export interface CfRule {
  /** Faixas de aplicação, em referência A1 (ex.: ["F2:F26", "F28:F51"]). */
  ranges: string[];
  type: CfType;
  operator?: CfOperator;
  formulas: string[];
  /** Índice em `dxfs`; ausente = regra sem formato (o Excel permite). */
  dxfId?: number;
  priority: number;
  stopIfTrue?: boolean;
  /** Âncora da primeira faixa — origem das referências relativas. */
  anchor: { row: number; col: number };
  /** Cores de barra de dados (1) ou escala de cores (2 ou 3). */
  colors?: string[];
  cfvo?: Cfvo[];
  /** Nome do conjunto de ícones do Excel (3TrafficLights1, 3Arrows…). */
  iconSet?: string;
  /** Barra de dados pode esconder o número e mostrar só a barra. */
  hideValue?: boolean;
}

/**
 * Resultado visual de uma regra. Barra, escala e ícone não são "estilo de
 * célula" — precisam de desenho próprio, por isso o tipo é mais rico.
 */
export type CfVisual =
  | { kind: 'style'; style: CellStyle }
  | { kind: 'dataBar'; ratio: number; color: string; hideValue: boolean }
  | { kind: 'colorScale'; color: string }
  | { kind: 'iconSet'; icon: string };

const OPERATORS = new Set<CfOperator>([
  'greaterThan', 'lessThan', 'equal', 'notEqual', 'greaterThanOrEqual',
  'lessThanOrEqual', 'between', 'notBetween', 'containsText', 'notContains',
  'beginsWith', 'endsWith',
]);

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : "'");
}

/** Primeira célula da primeira faixa: origem do deslocamento relativo. */
function anchorOf(ranges: string[]): { row: number; col: number } {
  const first = ranges[0]?.split(':')[0] ?? 'A1';
  return parseCellRef(first) ?? { row: 0, col: 0 };
}

/** Lê `<conditionalFormatting>` de uma aba, na ordem em que aparecem. */
export function parseConditionalFormatting(sheetXml: string, palette: ThemePalette = parseTheme(null)): CfRule[] {
  const out: CfRule[] = [];
  for (const block of sheetXml.matchAll(/<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>/g)) {
    const open = /<conditionalFormatting\b[^>]*>/.exec(block[0])![0];
    const sqref = attr(open, 'sqref') ?? '';
    const ranges = sqref.split(/\s+/).filter(Boolean);
    if (!ranges.length) continue;

    for (const ruleXml of block[0].matchAll(/<cfRule\b[^>]*>[\s\S]*?<\/cfRule>|<cfRule\b[^>]*\/>/g)) {
      const tag = /<cfRule\b[^>]*?\/?>/.exec(ruleXml[0])![0];
      const rawType = attr(tag, 'type') ?? '';
      const operator = attr(tag, 'operator') as CfOperator | undefined;
      const dxf = attr(tag, 'dxfId');
      const known: CfType[] = ['cellIs', 'expression', 'containsText', 'notContainsText',
        'dataBar', 'colorScale', 'iconSet'];
      const type: CfType = known.includes(rawType as CfType) ? rawType as CfType : 'unsupported';

      const colors = [...ruleXml[0].matchAll(/<color\b[^>]*\/?>/g)]
        .map((c) => colorFrom(c[0], palette))
        .filter((c): c is string => !!c);
      const cfvo = [...ruleXml[0].matchAll(/<cfvo\b[^>]*\/?>/g)].map((c) => {
        const val = attr(c[0], 'val');
        return { type: attr(c[0], 'type') ?? 'num', ...(val === undefined ? {} : { val }) };
      });

      out.push({
        ranges,
        type,
        operator: operator && OPERATORS.has(operator) ? operator : undefined,
        formulas: [...ruleXml[0].matchAll(/<formula>([\s\S]*?)<\/formula>/g)].map((f) => unescapeXml(f[1]!.trim())),
        ...(dxf === undefined ? {} : { dxfId: Number(dxf) }),
        priority: Number(attr(tag, 'priority') ?? '999'),
        ...(attr(tag, 'stopIfTrue') === '1' ? { stopIfTrue: true } : {}),
        anchor: anchorOf(ranges),
        ...(colors.length ? { colors } : {}),
        ...(cfvo.length ? { cfvo } : {}),
        ...(attr(tag, 'iconSet') === undefined ? {} : { iconSet: attr(tag, 'iconSet')! }),
        ...(/<dataBar\b[^>]*\bshowValue="0"/.test(ruleXml[0]) ? { hideValue: true } : {}),
        ...(attr(tag, 'text') === undefined ? {} : { formulas: [attr(tag, 'text')!] }),
      });
    }
  }
  return out;
}

/** A célula está dentro de alguma das faixas da regra? */
export function inRanges(ranges: string[], row: number, col: number): boolean {
  for (const range of ranges) {
    const [a, b] = range.split(':');
    const from = parseCellRef(a ?? '');
    if (!from) continue;
    const to = b ? parseCellRef(b) : from;
    if (!to) continue;
    const top = Math.min(from.row, to.row);
    const bottom = Math.max(from.row, to.row);
    const left = Math.min(from.col, to.col);
    const right = Math.max(from.col, to.col);
    if (row >= top && row <= bottom && col >= left && col <= right) return true;
  }
  return false;
}

// ── avaliador de fórmula (só o necessário para regras condicionais) ──

export interface EvalContext {
  /** Valor de uma célula por linha/coluna (0-based). */
  valueAt: (row: number, col: number) => CellValue;
  /** Serial do Excel para "hoje" — injetado para o teste ser determinístico. */
  today: number;
}

/** Data (serial do Excel) de hoje, à meia-noite. */
export function todaySerial(now = new Date()): number {
  const utcMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((utcMidnight - Date.UTC(1899, 11, 30)) / 86_400_000);
}

type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; row: number; col: number }
  | { t: 'op'; v: string } | { t: 'fn'; v: string } | { t: 'punc'; v: string };

/**
 * Tokeniza deslocando referências relativas. `$` fixa a coordenada (absoluta),
 * como no Excel.
 */
function tokenize(formula: string, dRow: number, dCol: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = formula.replace(/^=/, '');

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      let j = i + 1;
      let text = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') { text += '"'; j += 2; continue; }
        if (src[j] === '"') break;
        text += src[j];
        j++;
      }
      tokens.push({ t: 'str', v: text });
      i = j + 1;
      continue;
    }

    const ref = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/.exec(src.slice(i));
    if (ref) {
      const pos = parseCellRef(`${ref[2]}${ref[4]}`);
      if (pos) {
        tokens.push({
          t: 'ref',
          row: ref[3] ? pos.row : pos.row + dRow,
          col: ref[1] ? pos.col : pos.col + dCol,
        });
        i += ref[0].length;
        continue;
      }
    }

    const fn = /^([A-Za-z][A-Za-z0-9._]*)\s*\(/.exec(src.slice(i));
    if (fn) {
      tokens.push({ t: 'fn', v: fn[1]!.toUpperCase() });
      i += fn[0].length - 1;
      continue;
    }

    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }

    const op = ['<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '&'].find((o) => src.startsWith(o, i));
    if (op) { tokens.push({ t: 'op', v: op }); i += op.length; continue; }

    if (ch === '(' || ch === ')' || ch === ',' || ch === ';') { tokens.push({ t: 'punc', v: ch }); i++; continue; }

    // Qualquer coisa fora do subconjunto suportado (ex.: referência a outra aba).
    throw new Error(`formula_nao_suportada:${src.slice(i, i + 12)}`);
  }
  return tokens;
}

const FUNCTIONS: Record<string, (args: unknown[], ctx: EvalContext) => unknown> = {
  TODAY: (_a, ctx) => ctx.today,
  AND: (args) => args.every(truthy),
  OR: (args) => args.some(truthy),
  NOT: (args) => !truthy(args[0]),
  ABS: (args) => Math.abs(num(args[0])),
  ISBLANK: (args) => args[0] === null || args[0] === undefined || args[0] === '',
  LEN: (args) => String(args[0] ?? '').length,
};

const truthy = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0)
  || (typeof v === 'string' && v.toUpperCase() === 'VERDADEIRO');

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0);

/** Parser recursivo descendente sobre os tokens. */
function makeParser(tokens: Token[], ctx: EvalContext) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v: string) => { const t = peek(); if (t && (t.t === 'op' || t.t === 'punc') && t.v === v) { pos++; return true; } return false; };

  function primary(): unknown {
    const t = peek();
    if (!t) throw new Error('formula_incompleta');
    if (t.t === 'num') { pos++; return t.v; }
    if (t.t === 'str') { pos++; return t.v; }
    if (t.t === 'ref') { pos++; return ctx.valueAt(t.row, t.col); }
    if (t.t === 'op' && t.v === '-') { pos++; return -num(primary()); }
    if (t.t === 'op' && t.v === '+') { pos++; return primary(); }
    if (t.t === 'fn') {
      pos++;
      if (!eat('(')) throw new Error('formula_sem_parenteses');
      const args: unknown[] = [];
      if (!eat(')')) {
        do { args.push(expression()); } while (eat(',') || eat(';'));
        if (!eat(')')) throw new Error('formula_sem_fecha_parenteses');
      }
      const fn = FUNCTIONS[t.v];
      if (!fn) throw new Error(`funcao_nao_suportada:${t.v}`);
      return fn(args, ctx);
    }
    if (t.t === 'punc' && t.v === '(') {
      pos++;
      const v = expression();
      if (!eat(')')) throw new Error('formula_sem_fecha_parenteses');
      return v;
    }
    throw new Error('formula_inesperada');
  }

  function term(): unknown {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        pos++;
        const right = primary();
        left = t.v === '*' ? num(left) * num(right) : num(right) === 0 ? 0 : num(left) / num(right);
        continue;
      }
      return left;
    }
  }

  function additive(): unknown {
    let left = term();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '&')) {
        pos++;
        const right = term();
        if (t.v === '&') left = String(left ?? '') + String(right ?? '');
        else left = t.v === '+' ? num(left) + num(right) : num(left) - num(right);
        continue;
      }
      return left;
    }
  }

  function expression(): unknown {
    const left = additive();
    const t = peek();
    if (t?.t === 'op' && ['<', '>', '<=', '>=', '=', '<>'].includes(t.v)) {
      pos++;
      const right = additive();
      return compare(left, right, t.v);
    }
    return left;
  }

  return { run: () => expression() };
}

function compare(a: unknown, b: unknown, op: string): boolean {
  const bothText = typeof a === 'string' && typeof b === 'string';
  const x = bothText ? a.toUpperCase() : num(a);
  const y = bothText ? (b as string).toUpperCase() : num(b);
  switch (op) {
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    case '>=': return x >= y;
    case '=': return x === y;
    case '<>': return x !== y;
    default: return false;
  }
}

/**
 * Avalia uma fórmula de regra condicional para uma célula. Fórmula fora do
 * subconjunto suportado devolve `null` — a regra é ignorada em vez de pintar
 * errado.
 */
export function evalFormula(formula: string, dRow: number, dCol: number, ctx: EvalContext): unknown | null {
  try {
    return makeParser(tokenize(formula, dRow, dCol), ctx).run();
  } catch {
    return null;
  }
}

/** A regra casa nesta célula? Só decide o "se"; o formato vem do dxfId. */
export function ruleMatches(rule: CfRule, row: number, col: number, value: CellValue, ctx: EvalContext): boolean {
  const dRow = row - rule.anchor.row;
  const dCol = col - rule.anchor.col;

  if (rule.type === 'expression') {
    const result = evalFormula(rule.formulas[0] ?? '', dRow, dCol, ctx);
    return result === null ? false : truthy(result);
  }

  if (rule.type === 'containsText' || rule.type === 'notContainsText') {
    const needle = (rule.formulas[0] ?? '').toUpperCase();
    const has = needle !== '' && String(value ?? '').toUpperCase().includes(needle);
    return rule.type === 'containsText' ? has : !has;
  }

  if (rule.type !== 'cellIs' || !rule.operator) return false;
  if (value === null) return false;

  const limits = rule.formulas.map((f) => {
    const v = evalFormula(f, dRow, dCol, ctx);
    return v === null ? 0 : v;
  });
  const [first, second] = limits;

  switch (rule.operator) {
    case 'greaterThan': return compare(value, first, '>');
    case 'lessThan': return compare(value, first, '<');
    case 'greaterThanOrEqual': return compare(value, first, '>=');
    case 'lessThanOrEqual': return compare(value, first, '<=');
    case 'equal': return compare(value, first, '=');
    case 'notEqual': return compare(value, first, '<>');
    case 'between': return num(value) >= num(first) && num(value) <= num(second);
    case 'notBetween': return num(value) < num(first) || num(value) > num(second);
    case 'containsText': return String(value).toUpperCase().includes(String(first ?? '').toUpperCase());
    case 'notContains': return !String(value).toUpperCase().includes(String(first ?? '').toUpperCase());
    case 'beginsWith': return String(value).toUpperCase().startsWith(String(first ?? '').toUpperCase());
    case 'endsWith': return String(value).toUpperCase().endsWith(String(first ?? '').toUpperCase());
    default: return false;
  }
}

/**
 * Formato condicional efetivo de uma célula: percorre as regras aplicáveis por
 * prioridade e devolve o dxf da primeira que casa (respeitando stopIfTrue).
 */
export function conditionalStyle(
  rules: CfRule[],
  dxfs: CellStyle[],
  row: number,
  col: number,
  value: CellValue,
  ctx: EvalContext,
): CellStyle | null {
  const applicable = rules
    .filter((r) => r.type !== 'unsupported' && inRanges(r.ranges, row, col))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    if (!ruleMatches(rule, row, col, value, ctx)) continue;
    const dxf = rule.dxfId === undefined ? null : dxfs[rule.dxfId] ?? null;
    if (dxf) return dxf;
    if (rule.stopIfTrue) return null;
  }
  return null;
}

/** Contexto a partir do mapa de células do modelo. */
export function contextFrom(cells: Map<string, Cell>, today: number): EvalContext {
  return {
    valueAt: (row, col) => cells.get(cellKey(row, col))?.v ?? null,
    today,
  };
}

/** RRGGBB de um `<color>` de regra (aceita rgb, tema com tint e indexado do Excel). */
function colorFrom(tag: string, palette: ThemePalette): string | null {
  const rgb = attr(tag, 'rgb');
  if (rgb) return (rgb.length === 8 ? rgb.slice(2) : rgb).toUpperCase();
  const theme = attr(tag, 'theme');
  if (theme !== undefined) {
    const tint = Number(attr(tag, 'tint') ?? '0');
    return themeColor(palette, Number(theme), Number.isFinite(tint) ? tint : 0);
  }
  return null;
}

/** Números presentes nas faixas da regra — base de mínimo, máximo e percentil. */
function rangeNumbers(rule: CfRule, ctx: EvalContext): number[] {
  const out: number[] = [];
  for (const range of rule.ranges) {
    const [a, b] = range.split(':');
    const from = parseCellRef(a ?? '');
    if (!from) continue;
    const to = b ? parseCellRef(b) : from;
    if (!to) continue;
    const top = Math.min(from.row, to.row);
    const bottom = Math.max(from.row, to.row);
    const left = Math.min(from.col, to.col);
    const right = Math.max(from.col, to.col);
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const v = ctx.valueAt(row, col);
        if (typeof v === 'number') out.push(v);
      }
    }
  }
  return out;
}

/** Valor de um cfvo: min/max/percentil vêm dos dados, num vem da própria regra. */
function cfvoValue(cfvo: Cfvo | undefined, numbers: number[], fallback: number): number {
  if (!cfvo || !numbers.length) return fallback;
  const sorted = [...numbers].sort((a, b) => a - b);
  const explicit = Number(cfvo.val ?? '');
  switch (cfvo.type) {
    case 'min': return sorted[0]!;
    case 'max': return sorted[sorted.length - 1]!;
    case 'percent': {
      const lo = sorted[0]!;
      const hi = sorted[sorted.length - 1]!;
      return Number.isFinite(explicit) ? lo + ((hi - lo) * explicit) / 100 : fallback;
    }
    case 'percentile': {
      if (!Number.isFinite(explicit)) return fallback;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(((sorted.length - 1) * explicit) / 100)));
      return sorted[idx]!;
    }
    default: return Number.isFinite(explicit) ? explicit : fallback;
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Interpola duas cores em RRGGBB. */
function mix(a: string, b: string, t: number): string {
  const chan = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => Math.round(chan(a, i) + (chan(b, i) - chan(a, i)) * clamp01(t)));
  return out.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const ICONS: Record<string, string[]> = {
  '3TrafficLights1': ['🔴', '🟡', '🟢'],
  '3TrafficLights2': ['🔴', '🟡', '🟢'],
  '3Signs': ['🔻', '🔶', '🔷'],
  '3Arrows': ['↓', '→', '↑'],
  '3ArrowsGray': ['↓', '→', '↑'],
  '3Symbols': ['✖', '❗', '✔'],
  '3Symbols2': ['✖', '❗', '✔'],
  '3Flags': ['🚩', '🚩', '🚩'],
  '4Arrows': ['↓', '↘', '↗', '↑'],
  '5Arrows': ['↓', '↘', '→', '↗', '↑'],
  '5Quarters': ['○', '◔', '◑', '◕', '●'],
};

/**
 * Visual efetivo de uma célula: percorre as regras por prioridade e devolve o
 * primeiro desenho aplicável — estilo, barra, escala de cor ou ícone.
 */
export function conditionalVisual(
  rules: CfRule[],
  dxfs: CellStyle[],
  row: number,
  col: number,
  value: CellValue,
  ctx: EvalContext,
): CfVisual | null {
  const applicable = rules
    .filter((r) => r.type !== 'unsupported' && inRanges(r.ranges, row, col))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    if (rule.type === 'dataBar' || rule.type === 'colorScale' || rule.type === 'iconSet') {
      if (typeof value !== 'number') continue;
      const numbers = rangeNumbers(rule, ctx);
      if (!numbers.length) continue;
      const lo = cfvoValue(rule.cfvo?.[0], numbers, Math.min(...numbers));
      const hi = cfvoValue(rule.cfvo?.[rule.cfvo.length - 1], numbers, Math.max(...numbers));
      const span = hi - lo;
      const ratio = span === 0 ? 1 : clamp01((value - lo) / span);

      if (rule.type === 'dataBar') {
        const color = rule.colors?.[0] ?? '638EC6';
        return { kind: 'dataBar', ratio, color, hideValue: !!rule.hideValue };
      }
      if (rule.type === 'colorScale') {
        const colors = rule.colors ?? [];
        if (colors.length < 2) continue;
        if (colors.length === 2) return { kind: 'colorScale', color: mix(colors[0]!, colors[1]!, ratio) };
        // Três cores: a do meio fica no ponto declarado (padrão, o meio).
        const mid = rule.cfvo?.[1] ? cfvoValue(rule.cfvo[1], numbers, lo + span / 2) : lo + span / 2;
        const midRatio = span === 0 ? 0.5 : clamp01((mid - lo) / span);
        const color = ratio <= midRatio
          ? mix(colors[0]!, colors[1]!, midRatio === 0 ? 0 : ratio / midRatio)
          : mix(colors[1]!, colors[2]!, midRatio === 1 ? 1 : (ratio - midRatio) / (1 - midRatio));
        return { kind: 'colorScale', color };
      }
      const icons = ICONS[rule.iconSet ?? ''] ?? ICONS['3TrafficLights1']!;
      const idx = Math.min(icons.length - 1, Math.floor(ratio * icons.length));
      return { kind: 'iconSet', icon: icons[idx]! };
    }

    if (!ruleMatches(rule, row, col, value, ctx)) continue;
    const dxf = rule.dxfId === undefined ? null : dxfs[rule.dxfId] ?? null;
    if (dxf) return { kind: 'style', style: dxf };
    if (rule.stopIfTrue) return null;
  }
  return null;
}
