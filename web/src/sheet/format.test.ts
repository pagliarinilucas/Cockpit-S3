// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { formatValue, serialToDate } from './format';

describe('formatValue — sem formato', () => {
  it('vazio, texto e booleano', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue('abc')).toBe('abc');
    expect(formatValue(true)).toBe('VERDADEIRO');
    expect(formatValue(false)).toBe('FALSO');
  });

  it('número inteiro sai limpo e decimal com vírgula', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(3.5)).toBe('3,5');
  });

  it('não arrasta lixo de ponto flutuante', () => {
    expect(formatValue(0.1 + 0.2)).toBe('0,3');
  });
});

describe('formatValue — número e moeda', () => {
  it('duas casas com separador de milhar', () => {
    expect(formatValue(1234.5, '#,##0.00')).toBe('1.234,50');
    expect(formatValue(1234567.891, '#,##0.00')).toBe('1.234.567,89');
  });

  it('inteiro com milhar', () => {
    expect(formatValue(1234567, '#,##0')).toBe('1.234.567');
  });

  it('sem separador quando o código não pede', () => {
    expect(formatValue(1234.5, '0.00')).toBe('1234,50');
  });

  it('negativo mantém o sinal antes do milhar', () => {
    expect(formatValue(-9876.5, '#,##0.00')).toBe('-9.876,50');
  });

  it('moeda em reais', () => {
    expect(formatValue(1234.5, '"R$" #,##0.00')).toBe('R$ 1.234,50');
  });
});

describe('formatValue — percentual', () => {
  it('multiplica por cem', () => {
    expect(formatValue(0.42, '0.00%')).toBe('42,00%');
    expect(formatValue(0.075, '0%')).toBe('8%');
    expect(formatValue(1, '0.00%')).toBe('100,00%');
  });
});

describe('formatValue — data', () => {
  it('serial do Excel vira data', () => {
    expect(serialToDate(45000).toISOString().slice(0, 10)).toBe('2023-03-15');
    expect(formatValue(45000, 'dd/mm/yyyy')).toBe('15/03/2023');
  });

  it('data e hora, com mm depois de hh valendo minuto', () => {
    expect(formatValue(45000.5, 'dd/mm/yyyy hh:mm')).toBe('15/03/2023 12:00');
  });

  it('formato curto de ano', () => {
    expect(formatValue(45000, 'dd/mm/yy')).toBe('15/03/23');
  });
});

describe('formatValue — casos de borda', () => {
  it('texto com formato numérico continua texto', () => {
    expect(formatValue('n/a', '#,##0.00')).toBe('n/a');
  });

  it('formato de texto não mexe no número', () => {
    expect(formatValue(7, '@')).toBe('7');
  });

  it('código desconhecido cai no valor cru em vez de inventar', () => {
    expect(formatValue(1234.5, '[Blue]"algo"### ??/??')).toBe('1234,5');
  });
});
