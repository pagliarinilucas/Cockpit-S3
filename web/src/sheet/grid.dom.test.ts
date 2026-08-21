// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { mount } from '@vue/test-utils';
import Grid from './Grid.vue';
import { cellKey, type Cell, type CellStyle } from './model';

const HEAD_H = 26;
const HEAD_W = 56;

function gridOf(extra: Record<string, unknown> = {}) {
  const cells = new Map<string, Cell>([
    [cellKey(0, 0), { v: 'primeira linha' }],
    [cellKey(0, 1), { v: 'B1' }],
    [cellKey(1, 0), { v: 'segunda linha' }],
  ]);
  return mount(Grid, {
    props: {
      cells,
      styles: new Map<string, CellStyle>(),
      rows: 2,
      cols: 2,
      ...extra,
    },
    attachTo: document.body,
  });
}

const cellStyleAt = (wrapper: ReturnType<typeof gridOf>, row: number, col: number) => {
  const el = wrapper.element.querySelector(`[data-cell="${row}:${col}"]`) as HTMLElement | null;
  if (!el) throw new Error(`célula ${row}:${col} não foi desenhada`);
  return el.style;
};

const px = (value: string) => Number(value.replace('px', ''));

describe('a primeira linha não nasce debaixo do cabeçalho', () => {
  it('a célula A1 começa abaixo da faixa do cabeçalho de colunas', () => {
    const wrapper = gridOf();
    expect(px(cellStyleAt(wrapper, 0, 0).top)).toBeGreaterThanOrEqual(HEAD_H);
  });

  it('a célula A1 começa à direita do cabeçalho de linhas', () => {
    const wrapper = gridOf();
    expect(px(cellStyleAt(wrapper, 0, 0).left)).toBeGreaterThanOrEqual(HEAD_W);
  });

  it('o cabeçalho da linha 1 acompanha a célula da linha 1', () => {
    const wrapper = gridOf();
    const head = wrapper.element.querySelector('[data-rowhead="0"]') as HTMLElement;
    expect(px(head.style.top)).toBe(px(cellStyleAt(wrapper, 0, 0).top));
  });

  it('a tela reserva espaço para o cabeçalho na altura total', () => {
    const wrapper = gridOf();
    const canvas = wrapper.element.querySelector('.sg-canvas') as HTMLElement;
    const firstTop = px(cellStyleAt(wrapper, 0, 0).top);
    expect(px(canvas.style.height)).toBeGreaterThan(firstTop);
  });
});

describe('largura vinda do documento vivo', () => {
  it('a coluna arrastada fica com a largura pedida', () => {
    const wrapper = gridOf({ colWidths: new Map([[0, 300]]) });
    expect(px(cellStyleAt(wrapper, 0, 0).width)).toBe(300);
  });

  it('a coluna seguinte é empurrada pela largura da anterior', () => {
    const wrapper = gridOf({ colWidths: new Map([[0, 300]]) });
    expect(px(cellStyleAt(wrapper, 0, 1).left)).toBe(HEAD_W + 300);
  });

  it('a altura de linha desloca a linha de baixo', () => {
    const wrapper = gridOf({ rowHeights: new Map([[0, 80]]) });
    expect(px(cellStyleAt(wrapper, 0, 0).height)).toBe(80);
    expect(px(cellStyleAt(wrapper, 1, 0).top)).toBe(HEAD_H + 80);
  });
});

describe('abertura preenche a área visível inteira', () => {
  const sized = (h: number, w: number) => {
    const original = {
      height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
      width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    };
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => h, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => w, configurable: true });
    return () => {
      if (original.height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.height);
      if (original.width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original.width);
    };
  };

  const bigSheet = () => {
    const cells = new Map<string, Cell>();
    for (let r = 0; r < 200; r++) {
      for (let c = 0; c < 40; c++) cells.set(cellKey(r, c), { v: `${r}:${c}` });
    }
    return cells;
  };

  const mountBig = () => mount(Grid, {
    props: { cells: bigSheet(), styles: new Map<string, CellStyle>(), rows: 200, cols: 40 },
    attachTo: document.body,
  });

  it('desenha as linhas que caberiam numa janela alta, sem precisar rolar', async () => {
    const restore = sized(1400, 2400);
    try {
      const wrapper = mountBig();
      await wrapper.vm.$nextTick();
      const rows = new Set(
        [...wrapper.element.querySelectorAll('[data-cell]')].map((el) => (el as HTMLElement).dataset.cell!.split(':')[0]),
      );
      expect(rows.size).toBeGreaterThan(1400 / 26 - 2);
    } finally { restore(); }
  });

  it('desenha as colunas que caberiam numa janela larga, sem precisar rolar', async () => {
    const restore = sized(1400, 2400);
    try {
      const wrapper = mountBig();
      await wrapper.vm.$nextTick();
      const cols = new Set(
        [...wrapper.element.querySelectorAll('[data-cell]')].map((el) => (el as HTMLElement).dataset.cell!.split(':')[1]),
      );
      expect(cols.size).toBeGreaterThan(2400 / 112 - 2);
    } finally { restore(); }
  });

  it('rolar não acrescenta nada que já devesse estar lá na abertura', async () => {
    const restore = sized(1400, 2400);
    try {
      const wrapper = mountBig();
      await wrapper.vm.$nextTick();
      const atOpen = wrapper.element.querySelectorAll('[data-cell]').length;
      await wrapper.trigger('scroll');
      await wrapper.vm.$nextTick();
      expect(wrapper.element.querySelectorAll('[data-cell]').length).toBe(atOpen);
    } finally { restore(); }
  });
});

describe('alças de redimensionamento', () => {
  it('cada cabeçalho de coluna tem uma alça', () => {
    const wrapper = gridOf();
    expect(wrapper.element.querySelectorAll('.sg-grip-col').length).toBeGreaterThan(0);
  });

  it('arrastar a alça avisa o tamanho novo', async () => {
    const wrapper = gridOf();
    const grip = wrapper.element.querySelector('.sg-grip-col') as HTMLElement;
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('resizeCol');
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([0, 192]);
  });

  it('sem permissão de escrita o tamanho vale na tela, mas não é emitido', async () => {
    const wrapper = gridOf({ readonly: true });
    const grip = wrapper.element.querySelector('.sg-grip-col') as HTMLElement;
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('resizeCol')).toBeFalsy();
    expect(px(cellStyleAt(wrapper, 0, 0).width)).toBe(212);
  });

  it('não deixa arrastar até a coluna desaparecer', async () => {
    const wrapper = gridOf();
    const grip = wrapper.element.querySelector('.sg-grip-col') as HTMLElement;
    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -900, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('resizeCol')![0]).toEqual([0, 24]);
  });
});
