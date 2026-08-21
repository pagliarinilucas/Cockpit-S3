// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Motor de fórmulas: tokenizador, parser e avaliador.
 *
 * Escopo deliberado — o conjunto de funções cobre o que aparece em planilha de
 * escritório (soma, condicional, procura, data, texto). Função fora da lista
 * devolve #NAME?, e não um palpite: valor errado numa planilha financeira é pior
 * que uma célula com erro visível.
 *
 * Erros seguem o Excel (#DIV/0!, #VALUE!, #REF!, #NAME?, #N/A) e se propagam:
 * se um argumento é erro, o resultado é aquele erro.
 */
import { colIndex, parseCellRef, type CellValue } from './model';

export const ERRORS = ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#CYCLE!'] as const;
export type FormulaError = typeof ERRORS[number];

export const isError = (v: unknown): v is FormulaError =>
  typeof v === 'string' && (ERRORS as readonly string[]).includes(v);

/** Valor que uma célula pode ter depois de avaliada. */
export type Value = CellValue | FormulaError;

/** Acesso às células para o avaliador (0-based). */
export interface SheetAccess {
  valueAt: (row: number, col: number) => Value;
  /** Serial do Excel para hoje — injetado para o teste ser determinístico. */
  today: number;
  /** Serial + fração do dia para agora. */
  now?: number;
}

interface Ref { row: number; col: number; absRow: boolean; absCol: boolean }
interface RangeRef { from: Ref; to: Ref }

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: FormulaError }
  | { t: 'ref'; v: Ref }
  | { t: 'range'; v: RangeRef }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

class ParseError extends Error {}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/;

function readRef(src: string, at: number): { ref: Ref; length: number } | null {
  const m = REF_RE.exec(src.slice(at));
  if (!m) return null;
  const pos = parseCellRef(`${m[2]}${m[4]}`);
  if (!pos) return null;
  return {
    ref: { row: pos.row, col: pos.col, absRow: !!m[3], absCol: !!m[1] },
    length: m[0].length,
  };
}

/** Tokeniza deslocando referências relativas por (dRow, dCol). */
export function tokenize(formula: string, dRow = 0, dCol = 0): Token[] {
  const src = formula.replace(/^=/, '');
  const tokens: Token[] = [];
  let i = 0;

  const shift = (ref: Ref): Ref => ({
    ...ref,
    row: ref.absRow ? ref.row : ref.row + dRow,
    col: ref.absCol ? ref.col : ref.col + dCol,
  });

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '"') {
      let j = i + 1;
      let text = '';
      for (; j < src.length; j++) {
        if (src[j] === '"' && src[j + 1] === '"') { text += '"'; j++; continue; }
        if (src[j] === '"') break;
        text += src[j];
      }
      if (j >= src.length) throw new ParseError('texto_sem_fim');
      tokens.push({ t: 'str', v: text });
      i = j + 1;
      continue;
    }

    const err = ERRORS.find((e) => src.startsWith(e, i));
    if (err) { tokens.push({ t: 'err', v: err }); i += err.length; continue; }

    const bool = /^(TRUE|FALSE|VERDADEIRO|FALSO)(?![\w(])/i.exec(src.slice(i));
    if (bool) {
      tokens.push({ t: 'bool', v: /^(TRUE|VERDADEIRO)$/i.test(bool[1]!) });
      i += bool[0].length;
      continue;
    }

    const first = readRef(src, i);
    if (first) {
      const afterFirst = i + first.length;
      if (src[afterFirst] === ':') {
        const second = readRef(src, afterFirst + 1);
        if (second) {
          tokens.push({ t: 'range', v: { from: shift(first.ref), to: shift(second.ref) } });
          i = afterFirst + 1 + second.length;
          continue;
        }
      }
      tokens.push({ t: 'ref', v: shift(first.ref) });
      i = afterFirst;
      continue;
    }

    const fn = /^([A-Za-z][A-Za-z0-9._]*)\s*\(/.exec(src.slice(i));
    if (fn) { tokens.push({ t: 'fn', v: fn[1]!.toUpperCase() }); i += fn[0].length - 1; continue; }

    const name = /^[A-Za-z][A-Za-z0-9._]*/.exec(src.slice(i));
    if (name) throw new ParseError(`nome_desconhecido:${name[0]}`);

    const num = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }

    const op = ['<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '^', '&', '%'].find((o) => src.startsWith(o, i));
    if (op) { tokens.push({ t: 'op', v: op }); i += op.length; continue; }

    if (ch === '(' || ch === ')' || ch === ',' || ch === ';') { tokens.push({ t: 'punc', v: ch }); i++; continue; }

    throw new ParseError(`caractere_invalido:${ch}`);
  }
  return tokens;
}

// ── coerções ──

const numOf = (v: Value): number | FormulaError => {
  if (isError(v)) return v;
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const t = v.trim();
  if (t === '') return 0;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : '#VALUE!';
};

const textOf = (v: Value): string => {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
  return String(v);
};

const boolOf = (v: Value): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(TRUE|VERDADEIRO)$/i.test(v);
  return false;
};

/** Achata argumentos: faixa vira lista de valores. */
type Arg = Value | Value[];

const flat = (args: Arg[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));

const firstError = (values: Value[]): FormulaError | null =>
  (values.find(isError) as FormulaError | undefined) ?? null;

/** Só os números, ignorando texto e vazio — é como SUM e AVERAGE se comportam. */
function numbers(args: Arg[]): number[] | FormulaError {
  const out: number[] = [];
  for (const v of flat(args)) {
    if (isError(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    // texto e vazio ficam de fora, como no Excel
  }
  return out;
}

function compare(a: Value, b: Value, op: string): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  const bothText = typeof a === 'string' && typeof b === 'string';
  let x: number | string;
  let y: number | string;
  if (bothText) { x = a.toUpperCase(); y = (b as string).toUpperCase(); }
  else {
    const na = numOf(a);
    const nb = numOf(b);
    if (isError(na)) return na;
    if (isError(nb)) return nb;
    x = na; y = nb;
  }
  switch (op) {
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    case '>=': return x >= y;
    case '=': return x === y;
    case '<>': return x !== y;
    default: return '#VALUE!';
  }
}

// ── critérios (SUMIF / COUNTIF) ──

/** Interpreta ">10", "<=5", "<>x" ou um valor literal. */
export function matchesCriterion(value: Value, criterion: Value): boolean {
  if (typeof criterion === 'string') {
    const m = /^(<=|>=|<>|<|>|=)\s*(.*)$/.exec(criterion.trim());
    if (m) {
      const rhsText = m[2]!;
      const rhsNum = Number(rhsText.replace(',', '.'));
      const rhs: Value = rhsText !== '' && Number.isFinite(rhsNum) ? rhsNum : rhsText;
      const result = compare(value, rhs, m[1]!);
      return result === true;
    }
    // curinga simples: * e ?
    if (/[*?]/.test(criterion)) {
      const re = new RegExp(`^${criterion.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
      return re.test(textOf(value));
    }
  }
  if (criterion === null || criterion === '') return value === null || value === '';
  return compare(value, criterion, '=') === true;
}

// ── datas ──

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export const serialToUTC = (serial: number): Date => new Date(EXCEL_EPOCH + Math.round(serial * DAY_MS));
export const dateToSerial = (y: number, m: number, d: number): number =>
  Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY_MS);

// ── biblioteca de funções ──

type Fn = (args: Arg[], ctx: SheetAccess) => Value;

const agg = (reduce: (nums: number[]) => Value): Fn => (args) => {
  const nums = numbers(args);
  if (isError(nums)) return nums;
  return reduce(nums);
};

const round = (value: number, digits: number, mode: 'near' | 'up' | 'down'): number => {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded = mode === 'near'
    ? Math.sign(scaled) * Math.round(Math.abs(scaled))
    : mode === 'up' ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
      : Math.sign(scaled) * Math.floor(Math.abs(scaled));
  return rounded / factor;
};

/** Procura `needle` em `haystack` e devolve o índice (0-based) ou null. */
function matchIndex(needle: Value, haystack: Value[], type: number): number | null {
  if (type === 0) {
    for (let i = 0; i < haystack.length; i++) if (compare(haystack[i]!, needle, '=') === true) return i;
    return null;
  }
  // aproximado: maior valor <= needle (type 1) / menor >= needle (type -1)
  let best: number | null = null;
  for (let i = 0; i < haystack.length; i++) {
    const ok = type === 1 ? compare(haystack[i]!, needle, '<=') === true : compare(haystack[i]!, needle, '>=') === true;
    if (ok) best = i;
  }
  return best;
}

const FUNCTIONS: Record<string, Fn> = {
  SUM: agg((n) => n.reduce((a, b) => a + b, 0)),
  SOMA: agg((n) => n.reduce((a, b) => a + b, 0)),
  AVERAGE: agg((n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : '#DIV/0!')),
  MEDIA: agg((n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : '#DIV/0!')),
  MIN: agg((n) => (n.length ? Math.min(...n) : 0)),
  MAX: agg((n) => (n.length ? Math.max(...n) : 0)),
  COUNT: (args) => {
    const nums = numbers(args);
    return isError(nums) ? nums : nums.length;
  },
  COUNTA: (args) => flat(args).filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (args) => flat(args).filter((v) => v === null || v === '').length,

  ABS: (args) => { const n = numOf(flat(args)[0] ?? 0); return isError(n) ? n : Math.abs(n); },
  INT: (args) => { const n = numOf(flat(args)[0] ?? 0); return isError(n) ? n : Math.floor(n); },
  TRUNC: (args) => { const n = numOf(flat(args)[0] ?? 0); return isError(n) ? n : Math.trunc(n); },
  SQRT: (args) => {
    const n = numOf(flat(args)[0] ?? 0);
    if (isError(n)) return n;
    return n < 0 ? '#NUM!' : Math.sqrt(n);
  },
  POWER: (args) => {
    const [a, b] = flat(args).map(numOf);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return (a as number) ** (b as number);
  },
  MOD: (args) => {
    const [a, b] = flat(args).map(numOf);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return (b as number) === 0 ? '#DIV/0!' : (a as number) % (b as number);
  },
  ROUND: (args) => {
    const [v, d] = flat(args).map(numOf);
    if (isError(v)) return v;
    if (isError(d)) return d;
    return round(v as number, (d as number) ?? 0, 'near');
  },
  ROUNDUP: (args) => {
    const [v, d] = flat(args).map(numOf);
    if (isError(v)) return v;
    if (isError(d)) return d;
    return round(v as number, (d as number) ?? 0, 'up');
  },
  ROUNDDOWN: (args) => {
    const [v, d] = flat(args).map(numOf);
    if (isError(v)) return v;
    if (isError(d)) return d;
    return round(v as number, (d as number) ?? 0, 'down');
  },

  IF: (args) => {
    const cond = Array.isArray(args[0]) ? args[0][0] ?? null : args[0] ?? null;
    if (isError(cond)) return cond;
    const branch = boolOf(cond) ? args[1] : args[2];
    if (branch === undefined) return boolOf(cond) ? true : false;
    return Array.isArray(branch) ? branch[0] ?? null : branch;
  },
  IFERROR: (args) => {
    const v = Array.isArray(args[0]) ? args[0][0] ?? null : args[0] ?? null;
    if (!isError(v)) return v;
    const alt = args[1];
    return alt === undefined ? null : Array.isArray(alt) ? alt[0] ?? null : alt;
  },
  IFS: (args) => {
    const list = args;
    for (let i = 0; i + 1 < list.length; i += 2) {
      const cond = Array.isArray(list[i]) ? (list[i] as Value[])[0] ?? null : list[i] as Value;
      if (isError(cond)) return cond;
      if (boolOf(cond)) {
        const val = list[i + 1];
        return Array.isArray(val) ? val[0] ?? null : val as Value;
      }
    }
    return '#N/A';
  },
  AND: (args) => {
    const values = flat(args);
    return firstError(values) ?? values.every(boolOf);
  },
  OR: (args) => {
    const values = flat(args);
    return firstError(values) ?? values.some(boolOf);
  },
  NOT: (args) => {
    const v = flat(args)[0] ?? null;
    return isError(v) ? v : !boolOf(v);
  },

  CONCAT: (args) => flat(args).map(textOf).join(''),
  CONCATENATE: (args) => flat(args).map(textOf).join(''),
  LEN: (args) => textOf(flat(args)[0] ?? null).length,
  UPPER: (args) => textOf(flat(args)[0] ?? null).toUpperCase(),
  LOWER: (args) => textOf(flat(args)[0] ?? null).toLowerCase(),
  TRIM: (args) => textOf(flat(args)[0] ?? null).trim().replace(/\s+/g, ' '),
  LEFT: (args) => {
    const [v, n] = flat(args);
    const count = n === undefined ? 1 : numOf(n);
    return isError(count) ? count : textOf(v ?? null).slice(0, count as number);
  },
  RIGHT: (args) => {
    const [v, n] = flat(args);
    const count = n === undefined ? 1 : numOf(n);
    if (isError(count)) return count;
    const text = textOf(v ?? null);
    return (count as number) <= 0 ? '' : text.slice(Math.max(0, text.length - (count as number)));
  },
  MID: (args) => {
    const [v, start, len] = flat(args);
    const s = numOf(start ?? 1);
    const l = numOf(len ?? 0);
    if (isError(s)) return s;
    if (isError(l)) return l;
    return textOf(v ?? null).slice((s as number) - 1, (s as number) - 1 + (l as number));
  },

  TODAY: (_args, ctx) => ctx.today,
  NOW: (_args, ctx) => ctx.now ?? ctx.today,
  DATE: (args) => {
    const [y, m, d] = flat(args).map(numOf);
    if (isError(y)) return y;
    if (isError(m)) return m;
    if (isError(d)) return d;
    return dateToSerial(y as number, m as number, d as number);
  },
  YEAR: (args) => {
    const n = numOf(flat(args)[0] ?? 0);
    return isError(n) ? n : serialToUTC(n).getUTCFullYear();
  },
  MONTH: (args) => {
    const n = numOf(flat(args)[0] ?? 0);
    return isError(n) ? n : serialToUTC(n).getUTCMonth() + 1;
  },
  DAY: (args) => {
    const n = numOf(flat(args)[0] ?? 0);
    return isError(n) ? n : serialToUTC(n).getUTCDate();
  },
  DAYS: (args) => {
    const [a, b] = flat(args).map(numOf);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return (a as number) - (b as number);
  },

  ISBLANK: (args) => { const v = flat(args)[0] ?? null; return v === null || v === ''; },
  ISNUMBER: (args) => typeof (flat(args)[0] ?? null) === 'number',
  ISTEXT: (args) => typeof (flat(args)[0] ?? null) === 'string' && !isError(flat(args)[0]),
  ISERROR: (args) => isError(flat(args)[0] ?? null),

  SUMIF: (args) => {
    const range = args[0];
    const criterion = Array.isArray(args[1]) ? args[1][0] ?? null : args[1] ?? null;
    const sumRange = args[2] ?? range;
    if (!Array.isArray(range) || !Array.isArray(sumRange)) return '#VALUE!';
    let total = 0;
    range.forEach((v, i) => {
      if (!matchesCriterion(v, criterion)) return;
      const n = numOf(sumRange[i] ?? null);
      if (!isError(n)) total += n;
    });
    return total;
  },
  COUNTIF: (args) => {
    const range = args[0];
    const criterion = Array.isArray(args[1]) ? args[1][0] ?? null : args[1] ?? null;
    if (!Array.isArray(range)) return '#VALUE!';
    return range.filter((v) => matchesCriterion(v, criterion)).length;
  },
  SUMIFS: (args) => {
    const sumRange = args[0];
    if (!Array.isArray(sumRange)) return '#VALUE!';
    let total = 0;
    for (let i = 0; i < sumRange.length; i++) {
      let ok = true;
      for (let a = 1; a + 1 < args.length + 1 && a + 1 <= args.length; a += 2) {
        const range = args[a];
        const criterion = Array.isArray(args[a + 1]) ? (args[a + 1] as Value[])[0] ?? null : args[a + 1] as Value;
        if (!Array.isArray(range) || !matchesCriterion(range[i] ?? null, criterion)) { ok = false; break; }
      }
      if (!ok) continue;
      const n = numOf(sumRange[i] ?? null);
      if (!isError(n)) total += n;
    }
    return total;
  },
  COUNTIFS: (args) => {
    const first = args[0];
    if (!Array.isArray(first)) return '#VALUE!';
    let count = 0;
    for (let i = 0; i < first.length; i++) {
      let ok = true;
      for (let a = 0; a + 1 < args.length; a += 2) {
        const range = args[a];
        const criterion = Array.isArray(args[a + 1]) ? (args[a + 1] as Value[])[0] ?? null : args[a + 1] as Value;
        if (!Array.isArray(range) || !matchesCriterion(range[i] ?? null, criterion)) { ok = false; break; }
      }
      if (ok) count++;
    }
    return count;
  },
  MATCH: (args) => {
    const needle = Array.isArray(args[0]) ? args[0][0] ?? null : args[0] ?? null;
    const haystack = args[1];
    if (!Array.isArray(haystack)) return '#VALUE!';
    const type = args[2] === undefined ? 1 : Number(numOf(Array.isArray(args[2]) ? args[2][0] ?? 1 : args[2]));
    const idx = matchIndex(needle, haystack, type);
    return idx === null ? '#N/A' : idx + 1;
  },
  INDEX: (args) => {
    const list = args[0];
    if (!Array.isArray(list)) return '#VALUE!';
    const n = numOf(Array.isArray(args[1]) ? args[1][0] ?? 1 : args[1] ?? 1);
    if (isError(n)) return n;
    const value = list[(n as number) - 1];
    return value === undefined ? '#REF!' : value;
  },
};

/** Nomes reconhecidos — usado pela mensagem de erro e pela ajuda da interface. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

// ── parser ──

function parser(tokens: Token[], ctx: SheetAccess) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v: string) => {
    const t = peek();
    if (t && (t.t === 'op' || t.t === 'punc') && t.v === v) { pos++; return true; }
    return false;
  };

  /** Valores de uma faixa, em ordem de linha. */
  function rangeValues(r: RangeRef): Value[] {
    const top = Math.min(r.from.row, r.to.row);
    const bottom = Math.max(r.from.row, r.to.row);
    const left = Math.min(r.from.col, r.to.col);
    const right = Math.max(r.from.col, r.to.col);
    const out: Value[] = [];
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) out.push(ctx.valueAt(row, col));
    }
    return out;
  }

  function primary(): Arg {
    const t = peek();
    if (!t) throw new ParseError('formula_incompleta');

    if (t.t === 'num' || t.t === 'str' || t.t === 'bool' || t.t === 'err') { pos++; return t.v; }
    if (t.t === 'ref') { pos++; return ctx.valueAt(t.v.row, t.v.col); }
    if (t.t === 'range') { pos++; return rangeValues(t.v); }

    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      pos++;
      const inner = single(primaryWithPostfix());
      const n = numOf(inner);
      if (isError(n)) return n;
      return t.v === '-' ? -n : n;
    }

    if (t.t === 'fn') {
      pos++;
      if (!eat('(')) throw new ParseError('funcao_sem_parenteses');
      const args: Arg[] = [];
      if (!eat(')')) {
        do { args.push(expression()); } while (eat(',') || eat(';'));
        if (!eat(')')) throw new ParseError('funcao_sem_fechamento');
      }
      const fn = FUNCTIONS[t.v];
      if (!fn) return '#NAME?';
      return fn(args, ctx);
    }

    if (t.t === 'punc' && t.v === '(') {
      pos++;
      const v = expression();
      if (!eat(')')) throw new ParseError('parenteses_sem_fechamento');
      return v;
    }

    throw new ParseError('token_inesperado');
  }

  /** Percentual é sufixo: 10% = 0,1. */
  function primaryWithPostfix(): Arg {
    let value = primary();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && t.v === '%') {
        pos++;
        const n = numOf(single(value));
        if (isError(n)) return n;
        value = n / 100;
        continue;
      }
      return value;
    }
  }

  function power(): Arg {
    const base = primaryWithPostfix();
    const t = peek();
    if (t?.t === 'op' && t.v === '^') {
      pos++;
      const exponent = power();
      const a = numOf(single(base));
      const b = numOf(single(exponent));
      if (isError(a)) return a;
      if (isError(b)) return b;
      return a ** b;
    }
    return base;
  }

  function term(): Arg {
    let left = power();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        pos++;
        const right = power();
        const a = numOf(single(left));
        const b = numOf(single(right));
        if (isError(a)) { left = a; continue; }
        if (isError(b)) { left = b; continue; }
        if (t.v === '/' && b === 0) { left = '#DIV/0!'; continue; }
        left = t.v === '*' ? a * b : a / b;
        continue;
      }
      return left;
    }
  }

  function additive(): Arg {
    let left = term();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '&')) {
        pos++;
        const right = term();
        if (t.v === '&') {
          const a = single(left);
          const b = single(right);
          if (isError(a)) { left = a; continue; }
          if (isError(b)) { left = b; continue; }
          left = textOf(a) + textOf(b);
          continue;
        }
        const a = numOf(single(left));
        const b = numOf(single(right));
        if (isError(a)) { left = a; continue; }
        if (isError(b)) { left = b; continue; }
        left = t.v === '+' ? a + b : a - b;
        continue;
      }
      return left;
    }
  }

  function expression(): Arg {
    const left = additive();
    const t = peek();
    if (t?.t === 'op' && ['<', '>', '<=', '>=', '=', '<>'].includes(t.v)) {
      pos++;
      const right = additive();
      return compare(single(left), single(right), t.v);
    }
    return left;
  }

  return {
    run(): Value {
      const value = expression();
      if (pos < tokens.length) throw new ParseError('sobrou_token');
      return single(value);
    },
  };
}

/** Faixa usada onde se espera um valor único vira a primeira célula. */
const single = (v: Arg): Value => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Avalia a fórmula. Erro de sintaxe vira #VALUE! (o Excel recusa na digitação;
 * aqui a célula fica com erro visível em vez de derrubar a tela).
 */
export function evaluate(formula: string, ctx: SheetAccess, dRow = 0, dCol = 0): Value {
  try {
    return parser(tokenize(formula, dRow, dCol), ctx).run();
  } catch (e) {
    if (e instanceof ParseError) return '#VALUE!';
    throw e;
  }
}

/** Referências que a fórmula lê — usado para montar o grafo de dependências. */
export function referencesOf(formula: string): { row: number; col: number }[] {
  let tokens: Token[];
  try { tokens = tokenize(formula); } catch { return []; }
  const out: { row: number; col: number }[] = [];
  for (const t of tokens) {
    if (t.t === 'ref') out.push({ row: t.v.row, col: t.v.col });
    else if (t.t === 'range') {
      const top = Math.min(t.v.from.row, t.v.to.row);
      const bottom = Math.max(t.v.from.row, t.v.to.row);
      const left = Math.min(t.v.from.col, t.v.to.col);
      const right = Math.max(t.v.from.col, t.v.to.col);
      // Faixa gigante (coluna inteira) entra pelos limites, não célula a célula.
      const cells = (bottom - top + 1) * (right - left + 1);
      if (cells > 20_000) { out.push({ row: top, col: left }, { row: bottom, col: right }); continue; }
      for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) out.push({ row, col });
      }
    }
  }
  return out;
}

export { colIndex };
