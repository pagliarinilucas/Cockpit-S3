// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { computed, ref } from 'vue';
import { catalogs, type Catalog } from './catalog';
import { isPlural, type Plural } from './plural';

export type Locale = 'en' | 'pt';
export const LOCALES: { id: Locale; label: string; short: string; tag: string }[] = [
  { id: 'en', label: 'English', short: 'EN', tag: 'en' },
  { id: 'pt', label: 'Português', short: 'PT', tag: 'pt-BR' },
];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'cockpit.locale';

type Leaf = string | Plural;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string];

export type MessageKey = Paths<Catalog>;
export type MessageParams = Record<string, string | number>;

export function matchLocale(tag: string | null | undefined): Locale | null {
  const lower = (tag || '').trim().toLowerCase();
  if (lower === 'pt' || lower.startsWith('pt-') || lower.startsWith('pt_')) return 'pt';
  if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en';
  return null;
}

export function browserLocale(languages?: readonly string[]): Locale {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const tags = languages ?? (nav?.languages?.length ? nav.languages : [nav?.language ?? '']);
  for (const tag of tags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

function readStored(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en' || stored === 'pt' ? stored : null;
  } catch {
    return null;
  }
}

function writeStored(value: Locale) {
  try { localStorage.setItem(LOCALE_STORAGE_KEY, value); } catch { return; }
}

export function detectLocale(languages?: readonly string[]): Locale {
  return readStored() ?? browserLocale(languages);
}

export const locale = ref<Locale>(detectLocale());

export const localeTag = computed(() => LOCALES.find((l) => l.id === locale.value)!.tag);

function applyDocumentLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = localeTag.value;
}

export function setLocale(next: Locale, options: { persist?: boolean } = {}) {
  locale.value = next;
  if (options.persist !== false) writeStored(next);
  applyDocumentLang();
}

export function initLocale() {
  applyDocumentLang();
}

function lookup(catalog: unknown, key: string): Leaf | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || isPlural(node) ? node : undefined;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(tag: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(tag);
  if (!rules) { rules = new Intl.PluralRules(tag); pluralRules.set(tag, rules); }
  return rules.select(count);
}

function pickForm(forms: Plural, tag: string, count: number): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return pluralCategory(tag, count) === 'one' ? forms.one : forms.other;
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

export function translate(target: Locale, key: MessageKey, params?: MessageParams): string {
  const entry = lookup(catalogs[target], key) ?? lookup(catalogs[DEFAULT_LOCALE], key);
  if (entry === undefined) return key;
  const tag = LOCALES.find((l) => l.id === target)!.tag;
  const text = typeof entry === 'string' ? entry : pickForm(entry, tag, Number(params?.['count'] ?? 0));
  return interpolate(text, params);
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale.value, key, params);
}

export function fmtNumber(value: number): string {
  return value.toLocaleString(localeTag.value);
}

export function fmtDateTime(value: string | number | Date, fallback = ''): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(localeTag.value);
}

export function fmtDate(value: string | number | Date, fallback = ''): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString(localeTag.value);
}

export function fmtTime(value: string | number | Date, options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(localeTag.value, options);
}

export function useI18n() {
  return { t, locale, setLocale, locales: LOCALES, fmtNumber, fmtDateTime, fmtDate, fmtTime };
}
