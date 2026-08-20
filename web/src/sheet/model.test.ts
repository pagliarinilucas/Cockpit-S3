// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import {
  cellKey, cellRef, coerce, colName, display, editText, isBlankStyle, isSheetName,
  mergeStyle, parseCellKey, styleKey,
} from './model';

describe('coerce', () => {
  it('vazio vira null (apaga a célula)', () => {
    expect(coerce('')).toBeNull();
    expect(coerce('   ')).toBeNull();
  });

  it('inteiro e decimal com ponto', () => {
    expect(coerce('42')).toBe(42);
    expect(coerce('-7')).toBe(-7);
    expect(coerce('3.5')).toBe(3.5);
  });

  it('decimal com vírgula (pt-BR)', () => {
    expect(coerce('3,5')).toBe(3.5);
    expect(coerce('-0,25')).toBe(-0.25);
  });

  it('ponto em grupos de 3 é milhar, não decimal', () => {
    expect(coerce('1.500')).toBe(1500);
    expect(coerce('12.345.678')).toBe(12345678);
  });

  it('milhar com decimal em vírgula', () => {
    expect(coerce('1.234,56')).toBe(1234.56);
  });

  it('notação científica', () => {
    expect(coerce('1.5e3')).toBe(1500);
  });

  it('booleanos nos dois idiomas', () => {
    expect(coerce('VERDADEIRO')).toBe(true);
    expect(coerce('falso')).toBe(false);
    expect(coerce('true')).toBe(true);
  });

  it('texto continua texto, preservando espaços digitados', () => {
    expect(coerce('total geral')).toBe('total geral');
    expect(coerce(' 12A ')).toBe(' 12A ');
    expect(coerce('1.2.3')).toBe('1.2.3');
  });
});

describe('display e editText', () => {
  it('display usa o formatado do Excel quando existe', () => {
    expect(display({ v: 1234.5, w: '1.234,50' })).toBe('1.234,50');
  });

  it('sem `w`, formata pelo código de formato do estilo', () => {
    expect(display({ v: 1234.5 })).toBe('1234,5');
    expect(display({ v: 1234.5 }, { numFmt: '#,##0.00' })).toBe('1.234,50');
    expect(display({ v: 0.42 }, { numFmt: '0.00%' })).toBe('42,00%');
  });

  it('editText ignora o formatado e mostra o valor cru', () => {
    expect(editText({ v: 1234.5, w: '1.234,50' })).toBe('1234.5');
  });

  it('célula inexistente e nula viram texto vazio', () => {
    expect(display(undefined)).toBe('');
    expect(display({ v: null })).toBe('');
    expect(editText({ v: null })).toBe('');
  });

  it('booleano é exibido em português', () => {
    expect(display({ v: true })).toBe('VERDADEIRO');
    expect(display({ v: false })).toBe('FALSO');
  });
});

describe('endereçamento', () => {
  it('colName cobre a virada de uma para duas letras', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colName(51)).toBe('AZ');
    expect(colName(701)).toBe('ZZ');
    expect(colName(702)).toBe('AAA');
  });

  it('cellRef usa linha 1-based', () => {
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(8, 4)).toBe('E9');
  });

  it('cellKey e parseCellKey são inversos', () => {
    expect(parseCellKey(cellKey(7, 3))).toEqual({ row: 7, col: 3 });
    expect(parseCellKey('lixo')).toBeNull();
  });
});

describe('mergeStyle e styleKey', () => {
  it('mescla mantendo o que já existia', () => {
    expect(mergeStyle({ bold: true }, { bg: 'FF0000' })).toEqual({ bold: true, bg: 'FF0000' });
  });

  it('undefined e false removem o atributo (desligar negrito)', () => {
    expect(mergeStyle({ bold: true, bg: 'FF0000' }, { bold: undefined })).toEqual({ bg: 'FF0000' });
    expect(mergeStyle({ italic: true }, { italic: false })).toEqual({});
  });

  it('descarta o xf: visual novo não corresponde mais ao estilo do arquivo', () => {
    expect(mergeStyle({ xf: 7, bold: true }, { bg: '00FF00' })).toEqual({ bold: true, bg: '00FF00' });
  });

  it('trocar de cor substitui, não acumula', () => {
    expect(mergeStyle({ bg: 'FF0000' }, { bg: '00FF00' })).toEqual({ bg: '00FF00' });
  });

  it('styleKey ignora o xf e detecta visual igual', () => {
    expect(styleKey({ xf: 1, bg: 'FF0000' })).toBe(styleKey({ xf: 99, bg: 'FF0000' }));
    expect(styleKey({ bg: 'FF0000' })).not.toBe(styleKey({ bg: 'FF0001' }));
  });

  it('isBlankStyle reconhece estilo sem nada', () => {
    expect(isBlankStyle({})).toBe(true);
    expect(isBlankStyle({ xf: 4 })).toBe(true);
    expect(isBlankStyle({ bold: true })).toBe(false);
  });
});

describe('isSheetName', () => {
  it('aceita os formatos suportados, em qualquer caixa', () => {
    for (const n of ['a.xlsx', 'a.XLSM', 'dados.csv', 'dados.tsv']) expect(isSheetName(n)).toBe(true);
  });

  it('recusa o resto', () => {
    for (const n of ['a.pdf', 'a.xls', 'planilha', 'a.xlsx.zip']) expect(isSheetName(n)).toBe(false);
  });
});
