// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Formatação de célula para exibição. Cobre os formatos que o editor oferece na
 * barra, mais os padrões mais comuns do Excel; qualquer outro código cai no
 * valor cru — melhor mostrar o número do que inventar uma formatação errada.
 * Células que vieram do arquivo sem alteração usam o texto que o próprio Excel
 * já havia calculado (`w`), então este formatador só entra em cena no que o
 * usuário formatou aqui.
 */
import type { CellValue } from './model';

/** Formatos oferecidos na barra do editor. */
export const NUM_FORMATS = [
  { label: 'Geral', code: null },
  { label: 'Número', code: '#,##0.00' },
  { label: 'Inteiro', code: '#,##0' },
  { label: 'Moeda', code: '"R$" #,##0.00' },
  { label: 'Percentual', code: '0.00%' },
  { label: 'Data', code: 'dd/mm/yyyy' },
  { label: 'Data e hora', code: 'dd/mm/yyyy hh:mm' },
  { label: 'Texto', code: '@' },
] as const;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Serial do Excel -> Date (UTC). O bug do ano 1900 já está na própria época. */
export function serialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS));
}

const pad = (n: number) => String(n).padStart(2, '0');

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Número em convenção pt-BR: ponto no milhar, vírgula no decimal. */
function fixed(value: number, decimals: number, grouping: boolean): string {
  const negative = value < 0;
  const text = Math.abs(value).toFixed(decimals);
  const [int = '0', frac] = text.split('.');
  const head = grouping ? groupThousands(int) : int;
  return (negative ? '-' : '') + (frac ? `${head},${frac}` : head);
}

function decimalsOf(code: string): number {
  return /\.(0+)/.exec(code)?.[1]?.length ?? 0;
}

/**
 * Texto exibido para `value` sob o código de formato `code`. Sem código, número
 * sai com o mínimo de ruído e texto sai como está.
 */
export function formatValue(value: CellValue, code?: string): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'VERDADEIRO' : 'FALSO';
  if (!code || code === 'General') return typeof value === 'number' ? formatPlain(value) : String(value);
  if (code === '@') return String(value);

  if (typeof value !== 'number') return String(value);

  if (code.includes('%')) {
    return `${fixed(value * 100, decimalsOf(code), code.includes('#,##'))}%`;
  }
  if (/[yYmMdD]/.test(code) && !/[eE]\+/.test(code)) {
    return formatDate(value, code);
  }
  if (/R\$|\$/.test(code)) {
    return `R$ ${fixed(value, decimalsOf(code) || 2, true)}`;
  }
  if (/^[#0.,\s]+$/.test(code)) {
    return fixed(value, decimalsOf(code), code.includes(','));
  }
  return formatPlain(value);
}

/** Número sem formato declarado: até 10 casas, sem zeros à direita. */
function formatPlain(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10))).replace('.', ',');
}

function formatDate(serial: number, code: string): string {
  const d = serialToDate(serial);
  const parts: Record<string, string> = {
    yyyy: String(d.getUTCFullYear()),
    yy: pad(d.getUTCFullYear() % 100),
    mm: pad(d.getUTCMonth() + 1),
    dd: pad(d.getUTCDate()),
    hh: pad(d.getUTCHours()),
    ss: pad(d.getUTCSeconds()),
  };
  const lower = code.toLowerCase();
  const minutes = pad(d.getUTCMinutes());
  return lower.replace(/yyyy|yy|mm|dd|hh|ss/g, (token, offset: number) => {
    // "mm" depois de "hh" é minuto, não mês (convenção do Excel).
    if (token === 'mm' && /hh[^a-z0-9]*$/.test(lower.slice(0, offset))) return minutes;
    return parts[token] ?? token;
  });
}
