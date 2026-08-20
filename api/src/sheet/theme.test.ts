// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { applyTint, parseTheme, themeColor } from './theme';

/** clrScheme real do arquivo de conciliação (tema Office). */
const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="5B9BD5"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>`;

describe('parseTheme', () => {
  it('índices 0..3 seguem a ordem do Excel (lt1, dk1, lt2, dk2)', () => {
    const p = parseTheme(THEME);
    expect(p[0]).toBe('FFFFFF');
    expect(p[1]).toBe('000000');
    expect(p[2]).toBe('E7E6E6');
    expect(p[3]).toBe('44546A');
  });

  it('accents ficam em 4..9', () => {
    const p = parseTheme(THEME);
    expect(p[4]).toBe('5B9BD5');
    expect(p[5]).toBe('ED7D31');
    expect(p[7]).toBe('FFC000');
    expect(p[9]).toBe('70AD47');
  });

  it('hlink e folHlink no fim', () => {
    const p = parseTheme(THEME);
    expect(p[10]).toBe('0563C1');
    expect(p[11]).toBe('954F72');
  });

  it('sem theme1.xml usa a paleta Office padrão', () => {
    expect(parseTheme(null)[7]).toBe('FFC000');
    expect(parseTheme('<a:theme/>')[4]).toBe('5B9BD5');
  });

  it('slot ausente cai no padrão em vez de sumir', () => {
    const p = parseTheme(THEME.replace(/<a:accent4>[\s\S]*?<\/a:accent4>/, ''));
    expect(p[7]).toBe('FFC000');
  });
});

describe('applyTint', () => {
  it('tint zero não muda a cor', () => {
    expect(applyTint('5B9BD5', 0)).toBe('5B9BD5');
  });

  it('tint positivo clareia na direção do branco', () => {
    // FFC000 clareado 80% = FFF2CC, o mesmo valor que o Excel mostra em
    // "Accent4, Lighter 80%" — serve de conferência contra o Excel real.
    expect(applyTint('FFC000', 0.8)).toBe('FFF2CC');
  });

  it('tint negativo escurece', () => {
    expect(applyTint('FFFFFF', -0.5)).toBe('808080');
  });

  it('tint 1 vira branco e -1 vira preto', () => {
    expect(applyTint('123456', 1)).toBe('FFFFFF');
    expect(applyTint('123456', -1)).toBe('000000');
  });

  it('mantém 6 dígitos com zero à esquerda', () => {
    expect(applyTint('010203', -0.5)).toHaveLength(6);
  });
});

describe('themeColor', () => {
  it('resolve o caso real do arquivo: accent4 clareado 80%', () => {
    const p = parseTheme(THEME);
    expect(themeColor(p, 7, 0.79998168889431442)).toBe('FFF2CC');
  });

  it('accent2 clareado 60% (outra regra do mesmo arquivo)', () => {
    const p = parseTheme(THEME);
    expect(themeColor(p, 5, 0.59996337778862885)).toBe('F8CBAD');
  });

  it('índice fora da paleta devolve null em vez de cor errada', () => {
    expect(themeColor(parseTheme(THEME), 99, 0)).toBeNull();
  });
});
