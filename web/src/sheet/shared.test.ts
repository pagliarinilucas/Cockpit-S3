// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * O pacote @cockpit/sheet é o mesmo código que o servidor usa para entender o
 * arquivo. Aqui a verificação é do ponto de vista do cliente: o pacote resolve
 * e funciona a partir do web, sem apelido de caminho e sem build intermediário.
 * A pureza de cada módulo (nada de Node) é verificada dentro do próprio pacote.
 */
import { describe, expect, it } from 'bun:test';
import { conditionalStyle, contextFrom, todaySerial } from '@cockpit/sheet/conditional';
import { parseLayout } from '@cockpit/sheet/layout';
import { parseStyles } from '@cockpit/sheet/styles';
import { parseTheme } from '@cockpit/sheet/theme';
import { cellKey } from '@cockpit/sheet/model';
import { recalc } from '@cockpit/sheet/recalc';

describe('pacote compartilhado visto pelo cliente', () => {
  it('resolve e funciona a partir do web', () => {
    expect(cellKey(1, 2)).toBe('R1C2');
    expect(parseTheme(null)[7]).toBe('FFC000');
    expect(parseStyles('<styleSheet><cellXfs count="0"/></styleSheet>').dxfs).toEqual([]);
    expect(parseLayout('<worksheet><sheetData/></worksheet>').merges).toEqual([]);
    expect(typeof todaySerial()).toBe('number');
    expect(conditionalStyle([], [], 0, 0, 1, contextFrom(new Map(), 0))).toBeNull();
  });

  it('o motor de fórmulas roda no navegador, não só no servidor', () => {
    const cells = new Map([
      ['R0C0', { v: 10 }],
      ['R1C0', { v: 32 }],
      ['R2C0', { v: null, f: 'SUM(A1:A2)' }],
    ]);
    expect(recalc(cells, todaySerial()).values.get('R2C0')).toBe(42);
  });
});
