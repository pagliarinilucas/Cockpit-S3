// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { computed, ref } from 'vue';
import type { Branding } from './models';
import { hasExplicitTheme } from './theme';

export const DEFAULT_PRODUCT_NAME = 'Cockpit S3';

export const DEFAULT_BRANDING: Branding = {
  active: false,
  productName: DEFAULT_PRODUCT_NAME,
  accentColor: null,
  logo: null,
  sharePageMessage: '',
  hidePoweredBy: false,
};

const branding = ref<Branding>({ ...DEFAULT_BRANDING });
let loading: Promise<void> | null = null;

function applyAccent(color: string | null) {
  const root = document.documentElement;
  if (color && !hasExplicitTheme()) root.style.setProperty('--neon', color);
  else root.style.removeProperty('--neon');
}

export function applyBranding(next: Branding) {
  branding.value = next;
  document.title = next.active ? next.productName : DEFAULT_PRODUCT_NAME;
  applyAccent(next.active ? next.accentColor : null);
}

export function loadBranding(): Promise<void> {
  loading = fetch('/api/branding')
    .then((res) => (res.ok ? (res.json() as Promise<Branding>) : null))
    .then((data) => { if (data) applyBranding({ ...DEFAULT_BRANDING, ...data }); })
    .catch(() => {});
  return loading;
}

export function useBranding() {
  if (!loading) void loadBranding();
  const productName = computed(() => (branding.value.active ? branding.value.productName : DEFAULT_PRODUCT_NAME));
  const logo = computed(() => (branding.value.active ? branding.value.logo : null));
  const showPoweredBy = computed(() => branding.value.active && !branding.value.hidePoweredBy);
  return { branding, productName, logo, showPoweredBy, refresh: loadBranding };
}
