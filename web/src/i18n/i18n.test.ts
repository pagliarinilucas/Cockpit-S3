// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  LOCALE_STORAGE_KEY, browserLocale, detectLocale, interpolate, locale, matchLocale, setLocale, t, translate,
  type MessageKey,
} from './index';
import { catalogs } from './catalog';
import { isPlural } from './plural';

type Entries = Map<string, string | { [form: string]: string }>;

function flatten(node: unknown, prefix = '', out: Entries = new Map()): Entries {
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string' || isPlural(value)) out.set(path, value as string);
    else flatten(value, path, out);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const texts = (entry: string | { [form: string]: string }) => (typeof entry === 'string' ? [entry] : Object.values(entry));

afterEach(() => {
  try { localStorage.removeItem(LOCALE_STORAGE_KEY); } catch { return; }
  setLocale('en', { persist: false });
});

describe('locale detection', () => {
  it('maps pt and pt-BR tags to Portuguese', () => {
    expect(matchLocale('pt')).toBe('pt');
    expect(matchLocale('pt-BR')).toBe('pt');
    expect(matchLocale('PT-pt')).toBe('pt');
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('de-DE')).toBeNull();
  });

  it('defaults to English when no browser language is supported', () => {
    expect(browserLocale(['de-DE', 'fr'])).toBe('en');
    expect(browserLocale([])).toBe('en');
  });

  it('picks the first supported language in navigator.languages order', () => {
    expect(browserLocale(['pt-BR', 'en-US'])).toBe('pt');
    expect(browserLocale(['en-US', 'pt-BR'])).toBe('en');
    expect(browserLocale(['es', 'pt'])).toBe('pt');
  });

  it('reads navigator.languages when no list is given', () => {
    Object.defineProperty(navigator, 'languages', { value: ['pt-BR'], configurable: true });
    try {
      expect(browserLocale()).toBe('pt');
    } finally {
      delete (navigator as { languages?: readonly string[] }).languages;
    }
  });

  it('a stored choice wins over the browser language', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'pt');
    expect(detectLocale(['en-US'])).toBe('pt');
  });

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(detectLocale(['pt-BR'])).toBe('pt');
    expect(detectLocale(['de'])).toBe('en');
  });

  it('survives a storage that throws', () => {
    const spy = spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(detectLocale(['pt-BR'])).toBe('pt');
    spy.mockRestore();
  });
});

describe('switching language', () => {
  it('persists the choice and updates <html lang>', () => {
    setLocale('pt');
    expect(locale.value).toBe('pt');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('can switch without persisting', () => {
    setLocale('pt', { persist: false });
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('does not break when storage refuses writes', () => {
    const spy = spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => setLocale('pt')).not.toThrow();
    expect(locale.value).toBe('pt');
    spy.mockRestore();
  });

  it('t follows the active locale', () => {
    setLocale('en', { persist: false });
    expect(t('common.save')).toBe('Save');
    setLocale('pt', { persist: false });
    expect(t('common.save')).toBe('Salvar');
  });
});

describe('translate', () => {
  it('interpolates named params', () => {
    expect(translate('en', 'errors.withStatus', { status: 500, action: 'save' })).toBe('Error 500 trying to save.');
    expect(translate('pt', 'errors.withStatus', { status: 500, action: 'salvar' })).toBe('Erro 500 ao salvar.');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('Hi {name}, {missing}', { name: 'Ana' })).toBe('Hi Ana, {missing}');
  });

  it('chooses the plural form from count', () => {
    expect(translate('pt', 'time.months', { count: 1 })).toBe('1 mês');
    expect(translate('pt', 'time.months', { count: 3 })).toBe('3 meses');
    expect(translate('en', 'time.months', { count: 3 })).toBe('3 mo');
  });

  it('falls back to English when a Portuguese entry is missing', () => {
    const common = catalogs.pt.common as Record<string, string>;
    const saved = common['save']!;
    delete common['save'];
    try {
      expect(translate('pt', 'common.save')).toBe('Save');
    } finally {
      common['save'] = saved;
    }
  });

  it('returns the key itself when no catalog has it', () => {
    expect(translate('pt', 'nope.missing' as MessageKey)).toBe('nope.missing');
  });
});

describe('catalogs', () => {
  const en = flatten(catalogs.en);
  const pt = flatten(catalogs.pt);

  it('have exactly the same keys', () => {
    expect([...pt.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('agree on which entries are plural', () => {
    for (const [key, value] of en) expect([key, typeof pt.get(key)]).toEqual([key, typeof value]);
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, value] of en) {
      const expected = [...new Set(texts(value).flatMap(placeholders))].sort();
      for (const text of texts(pt.get(key)!)) {
        for (const name of placeholders(text)) expect([key, expected.includes(name!)]).toEqual([key, true]);
      }
    }
  });

  it('have no empty messages', () => {
    for (const [key, value] of [...en, ...pt]) {
      for (const text of texts(value)) expect([key, text.trim().length > 0]).toEqual([key, true]);
    }
  });
});
