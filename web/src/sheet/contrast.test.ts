// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { contrastRatio, inkFor, luminance } from './contrast';

describe('luminance', () => {
  it('preto e branco nos extremos', () => {
    expect(luminance('000000')).toBe(0);
    expect(luminance('FFFFFF')).toBeCloseTo(1, 5);
  });

  it('verde pesa mais que azul', () => {
    expect(luminance('00FF00')).toBeGreaterThan(luminance('0000FF'));
  });
});

describe('inkFor — cores reais do arquivo de conciliação', () => {
  /** Estes são os preenchimentos que a planilha usa de verdade. */
  const claros = ['FFF2CC', 'FBE5D6', 'F8CBAD', 'E2EFDA', 'BDD7EE', 'F4B183', 'FF7575', 'FFFFFF'];
  const escuros = ['1F2933', '000000', 'C00000', '44546A'];

  it('preenchimento claro pede tinta escura', () => {
    for (const bg of claros) expect(inkFor(bg)).toBe('#1f2933');
  });

  it('preenchimento escuro pede tinta clara', () => {
    for (const bg of escuros) expect(inkFor(bg)).toBe('#f5f7fa');
  });

  it('a tinta escolhida sempre passa do mínimo de contraste (4.5)', () => {
    for (const bg of [...claros, ...escuros]) {
      expect(contrastRatio(bg, inkFor(bg).slice(1))).toBeGreaterThan(4.5);
    }
  });
});

describe('contrastRatio', () => {
  it('preto sobre branco é o máximo', () => {
    expect(contrastRatio('000000', 'FFFFFF')).toBeCloseTo(21, 1);
  });

  it('cor igual não tem contraste', () => {
    expect(contrastRatio('FFF2CC', 'FFF2CC')).toBe(1);
  });

  it('é o caso que estava quebrado: texto claro em amarelo claro reprova', () => {
    expect(contrastRatio('FFF2CC', 'DBE6F5')).toBeLessThan(1.5);
  });
});
