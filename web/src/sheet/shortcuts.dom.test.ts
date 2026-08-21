// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { mount } from '@vue/test-utils';
import Shortcuts from './Shortcuts.vue';
import { SHORTCUT_GROUPS } from './shortcuts';

const panel = (props: Record<string, unknown> = {}) =>
  mount(Shortcuts, { props, attachTo: document.body });

describe('painel de atalhos', () => {
  it('mostra todos os grupos', () => {
    const wrapper = panel();
    const titles = [...wrapper.element.querySelectorAll('.sk-group-title')].map((el) => el.textContent);
    expect(titles).toEqual(SHORTCUT_GROUPS.map((g) => g.title));
  });

  it('mostra todos os atalhos, sem esquecer nenhum', () => {
    const wrapper = panel();
    const rows = wrapper.element.querySelectorAll('[data-shortcut]');
    const total = SHORTCUT_GROUPS.reduce((acc, g) => acc + g.items.length, 0);
    expect(rows.length).toBe(total);
  });

  it('desenha a tecla como tecla e o conectivo como texto', () => {
    const wrapper = panel();
    const keys = [...wrapper.element.querySelectorAll('kbd')].map((el) => el.textContent);
    expect(keys).toContain('Ctrl');
    expect(keys).toContain('Backspace');
    expect(keys).not.toContain('+');
    expect(keys).not.toContain('ou');
  });

  it('avisa quem só está lendo que os atalhos de edição não valem', () => {
    expect(panel({ readonly: true }).element.querySelector('.sk-ro')).not.toBeNull();
    expect(panel().element.querySelector('.sk-ro')).toBeNull();
  });

  it('clicar no fundo fecha', async () => {
    const wrapper = panel();
    await wrapper.find('.sk-back').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('clicar dentro do painel não fecha', async () => {
    const wrapper = panel();
    await wrapper.find('[data-shortcuts]').trigger('click');
    expect(wrapper.emitted('close')).toBeFalsy();
  });
});
