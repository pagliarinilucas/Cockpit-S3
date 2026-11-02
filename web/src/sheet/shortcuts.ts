// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { t, type MessageKey } from '../i18n';
import type { Catalog } from '../i18n/catalog';

export interface Shortcut {
  keys: string[];
  what: string;
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

type ShortcutWord = keyof Catalog['sheet']['shortcuts']['words'];
type KeyToken = string | { word: ShortcutWord };

interface ShortcutSpec {
  keys: KeyToken[];
  what: MessageKey;
  note?: MessageKey;
}

interface ShortcutGroupSpec {
  title: MessageKey;
  items: ShortcutSpec[];
}

const word = (name: ShortcutWord) => ({ word: name });

export const NAVIGATION: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.navigation.title',
  items: [
    { keys: ['↑', '↓', '←', '→'], what: 'sheet.shortcuts.navigation.moveCell' },
    { keys: ['Ctrl', '+', word('arrows')], what: 'sheet.shortcuts.navigation.jump', note: 'sheet.shortcuts.navigation.jumpNote' },
    { keys: ['Tab'], what: 'sheet.shortcuts.navigation.right' },
    { keys: ['Shift', '+', 'Tab'], what: 'sheet.shortcuts.navigation.left' },
    { keys: ['Home'], what: 'sheet.shortcuts.navigation.home' },
  ],
};

export const SELECTION: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.selection.title',
  items: [
    { keys: ['Shift', '+', word('arrows')], what: 'sheet.shortcuts.selection.extend' },
    { keys: [word('click'), '+', word('drag')], what: 'sheet.shortcuts.selection.range' },
    { keys: [word('clickHeader')], what: 'sheet.shortcuts.selection.whole' },
    { keys: ['Ctrl', '+', word('click')], what: 'sheet.shortcuts.selection.join', note: 'sheet.shortcuts.selection.joinNote' },
    { keys: ['Ctrl', '+', 'A'], what: 'sheet.shortcuts.selection.all' },
  ],
};

export const EDITING: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.editing.title',
  items: [
    { keys: ['Enter'], what: 'sheet.shortcuts.editing.open' },
    { keys: ['F2'], what: 'sheet.shortcuts.editing.open' },
    { keys: [word('doubleClick')], what: 'sheet.shortcuts.editing.open' },
    { keys: [word('type')], what: 'sheet.shortcuts.editing.overwrite' },
    { keys: ['='], what: 'sheet.shortcuts.editing.formula', note: 'sheet.shortcuts.editing.formulaNote' },
    { keys: ['Delete', word('or'), 'Backspace'], what: 'sheet.shortcuts.editing.clear', note: 'sheet.shortcuts.editing.clearNote' },
    { keys: ['Ctrl', '+', 'C'], what: 'sheet.shortcuts.editing.copy' },
    { keys: ['Ctrl', '+', 'V'], what: 'sheet.shortcuts.editing.paste', note: 'sheet.shortcuts.editing.pasteNote' },
  ],
};

export const WHILE_EDITING: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.whileEditing.title',
  items: [
    { keys: ['Enter'], what: 'sheet.shortcuts.whileEditing.confirmDown' },
    { keys: ['Tab'], what: 'sheet.shortcuts.whileEditing.confirmRight' },
    { keys: ['Esc'], what: 'sheet.shortcuts.whileEditing.cancel' },
  ],
};

export const SIZING: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.sizing.title',
  items: [
    { keys: [word('dragHandle')], what: 'sheet.shortcuts.sizing.resize', note: 'sheet.shortcuts.sizing.resizeNote' },
    { keys: [word('doubleClickHandle')], what: 'sheet.shortcuts.sizing.fit' },
  ],
};

export const PANEL: ShortcutGroupSpec = {
  title: 'sheet.shortcuts.panel.title',
  items: [
    { keys: ['Ctrl', '+', '/'], what: 'sheet.shortcuts.panel.toggle' },
    { keys: ['F1'], what: 'sheet.shortcuts.panel.toggle' },
    { keys: ['Esc'], what: 'sheet.shortcuts.panel.close' },
  ],
};

export const SHORTCUT_GROUP_SPECS: ShortcutGroupSpec[] = [
  NAVIGATION, SELECTION, EDITING, WHILE_EDITING, SIZING, PANEL,
];

const resolveToken = (token: KeyToken): string =>
  typeof token === 'string' ? token : t(`sheet.shortcuts.words.${token.word}`);

export function shortcutGroups(): ShortcutGroup[] {
  return SHORTCUT_GROUP_SPECS.map((group) => ({
    title: t(group.title),
    items: group.items.map((item) => ({
      keys: item.keys.map(resolveToken),
      what: t(item.what),
      ...(item.note ? { note: t(item.note) } : {}),
    })),
  }));
}

export function shortcutConnectors(): Set<string> {
  return new Set(['+', t('sheet.shortcuts.words.or'), t('sheet.shortcuts.words.and')]);
}

export const isShortcutPanelKey = (ev: KeyboardEvent): boolean =>
  ev.key === 'F1' || ((ev.ctrlKey || ev.metaKey) && ev.key === '/');
