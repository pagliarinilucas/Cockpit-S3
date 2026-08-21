// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Lista de atalhos que mente é pior que lista nenhuma: manda a pessoa apertar
 * uma tecla que não faz nada. Estes testes amarram o texto ao comportamento —
 * cada tecla documentada precisa existir no tratador do grid, e cada tecla
 * tratada precisa estar documentada.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHORTCUT_GROUPS, isShortcutPanelKey } from './shortcuts';

const grid = readFileSync(join(import.meta.dir, 'Grid.vue'), 'utf8');

const handler = grid.slice(grid.indexOf('function onKey'), grid.indexOf('function onPaste'));

const documented = new Set(
  SHORTCUT_GROUPS.flatMap((group) => group.items.flatMap((item) => item.keys)),
);

describe('atalhos documentados existem no grid', () => {
  const NAMED_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Tab', 'Enter', 'F2', 'Home', 'Delete', 'Backspace'];

  for (const key of NAMED_KEYS) {
    it(`${key} é tratado`, () => {
      expect(handler).toContain(`'${key}'`);
    });
  }

  it('as setas aparecem na lista como símbolo', () => {
    for (const arrow of ['↑', '↓', '←', '→']) expect(documented.has(arrow)).toBe(true);
  });

  it('Delete e Backspace limpam a seleção juntos, e a lista mostra as duas', () => {
    expect(handler).toContain("case 'Delete': case 'Backspace'");
    const item = SHORTCUT_GROUPS.flatMap((g) => g.items).find((i) => i.keys.includes('Delete'));
    expect(item?.keys).toContain('Backspace');
  });

  it('Ctrl + A seleciona tudo', () => {
    expect(handler).toContain("=== 'a'");
    expect(documented.has('A')).toBe(true);
  });

  it('Ctrl com seta pula um passo maior, e a lista não promete a borda dos dados', () => {
    expect(handler).toContain('ev.ctrlKey ? 10 : 1');
    const item = SHORTCUT_GROUPS.flatMap((g) => g.items).find((i) => i.what.includes('Pula 10'));
    expect(item?.note).toContain('Excel');
  });
});

describe('nenhuma tecla tratada fica fora da lista', () => {
  it('toda tecla nomeada no tratador está documentada', () => {
    const treated = new Set(
      [...handler.matchAll(/case '([A-Za-z0-9]+)':/g)].map((m) => m[1]!),
    );
    const ARROW_OF: Record<string, string> = {
      ArrowDown: '↓', ArrowUp: '↑', ArrowRight: '→', ArrowLeft: '←',
    };
    const missing = [...treated].filter((key) => !documented.has(ARROW_OF[key] ?? key));
    expect(missing).toEqual([]);
  });
});

describe('tecla que abre o painel', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }) => new KeyboardEvent('keydown', init);

  it('Ctrl + / abre', () => {
    expect(isShortcutPanelKey(key({ key: '/', ctrlKey: true }))).toBe(true);
  });

  it('Cmd + / abre, para quem está no mac', () => {
    expect(isShortcutPanelKey(key({ key: '/', metaKey: true }))).toBe(true);
  });

  it('F1 abre', () => {
    expect(isShortcutPanelKey(key({ key: 'F1' }))).toBe(true);
  });

  it('barra sozinha não abre — é caractere que se digita numa célula', () => {
    expect(isShortcutPanelKey(key({ key: '/' }))).toBe(false);
  });

  it('Ctrl + outra tecla não abre', () => {
    expect(isShortcutPanelKey(key({ key: 'c', ctrlKey: true }))).toBe(false);
  });
});
