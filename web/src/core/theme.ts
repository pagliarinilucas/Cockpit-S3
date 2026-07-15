// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { ref } from 'vue';

export interface ThemeDef {
  id: string;
  label: string;
  accent: string;
  base: string;
}

/** All themes are dark. Colors live in styles.css under html[data-theme]. */
export const THEMES: ThemeDef[] = [
  { id: 'graphite', label: 'Graphite', accent: '#2dd4ff', base: '#0a0e15' },
  { id: 'cobalt',   label: 'Cobalt',   accent: '#4f8cff', base: '#070c1a' },
  { id: 'hauler',   label: 'Hauler',   accent: '#ffb02e', base: '#13100a' },
  { id: 'cargo',    label: 'Cargo',    accent: '#36e2a0', base: '#08120d' },
  { id: 'carbon',   label: 'Carbon',   accent: '#7cf2ff', base: '#0a0a0c' },
];

const THEME_KEY = 'cockpit.theme';
const SCAN_KEY = 'cockpit.scanlines';

const current = ref<string>('graphite');
const scanlines = ref<boolean>(false);

function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
function apply() {
  const root = document.documentElement;
  root.dataset['theme'] = current.value;
  root.classList.toggle('no-scanlines', !scanlines.value);
}

/** Called once at startup (before mount). */
export function initTheme() {
  const saved = read(THEME_KEY);
  current.value = THEMES.some((t) => t.id === saved) ? saved! : 'graphite';
  scanlines.value = read(SCAN_KEY) === '1';
  apply();
}

export function useTheme() {
  const setTheme = (id: string) => {
    if (!THEMES.some((t) => t.id === id)) return;
    current.value = id;
    write(THEME_KEY, id);
    apply();
  };
  const toggleScanlines = () => {
    scanlines.value = !scanlines.value;
    write(SCAN_KEY, scanlines.value ? '1' : '0');
    apply();
  };
  return { themes: THEMES, current, scanlines, setTheme, toggleScanlines };
}
