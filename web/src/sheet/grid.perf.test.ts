// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * O primeiro desenho da planilha ficou pesado porque cada célula pedia o visual
 * condicional várias vezes (fundo, texto, barra, ícone, alinhamento). Este teste
 * fixa o contrato: uma avaliação por célula desenhada, no máximo.
 */
import { describe, expect, it, mock } from 'bun:test';
import { mount } from '@vue/test-utils';
import { cellKey, type Cell, type CellStyle } from './model';
import type { CfRule } from '@cockpit/sheet/conditional';

const real = await import('@cockpit/sheet/conditional');

const original = real.conditionalVisual;

let calls = 0;
mock.module('@cockpit/sheet/conditional', () => ({
  ...real,
  conditionalVisual: (...args: Parameters<typeof original>) => {
    calls++;
    return original(...args);
  },
}));

const Grid = (await import('./Grid.vue')).default;

const ROWS = 30;
const COLS = 8;

function sheet(): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) cells.set(cellKey(r, c), { v: r * COLS + c });
  }
  return cells;
}

const everywhere = { ranges: [`A1:H${ROWS}`], anchor: { row: 0, col: 0 } };

const rules: CfRule[] = [
  { ...everywhere, type: 'cellIs', operator: 'greaterThan', formulas: ['100'], dxfId: 0, priority: 1 },
  { ...everywhere, type: 'dataBar', formulas: [], priority: 2, colors: ['FF638EC6'] },
  { ...everywhere, type: 'cellIs', operator: 'lessThan', formulas: ['10'], dxfId: 0, priority: 3 },
];

describe('custo do primeiro desenho', () => {
  it('avalia a formatação condicional no máximo uma vez por célula', () => {
    calls = 0;
    const wrapper = mount(Grid, {
      props: {
        cells: sheet(),
        styles: new Map<string, CellStyle>(),
        rows: ROWS,
        cols: COLS,
        cf: rules,
        dxfs: [{ bg: 'FFFF0000' }],
      },
      attachTo: document.body,
    });

    const drawn = wrapper.element.querySelectorAll('[data-cell]').length;
    expect(drawn).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(drawn);
  });

  it('rolar não reavalia as células que já foram avaliadas', async () => {
    const wrapper = mount(Grid, {
      props: {
        cells: sheet(),
        styles: new Map<string, CellStyle>(),
        rows: ROWS,
        cols: COLS,
        cf: rules,
        dxfs: [{ bg: 'FFFF0000' }],
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    calls = 0;
    await wrapper.trigger('scroll');
    await wrapper.vm.$nextTick();
    expect(calls).toBe(0);
  });
});
