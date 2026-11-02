// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { ref } from 'vue';
import type { EditionInfo, LicenseFeature } from './models';
import { api } from './api';

export const PRICING_URL = 'https://github.com/pagliarinilucas/Cockpit-S3#pricing';
export const SALES_EMAIL = 'cockpits3@pm.me';
export const OPEN_LICENSE_KEY = Symbol('openLicense');

const edition = ref<EditionInfo>({ edition: 'community', features: [] });
let loading: Promise<void> | null = null;

export function refreshEdition(): Promise<void> {
  loading = api.edition()
    .then((info) => { edition.value = info; })
    .catch(() => {});
  return loading;
}

export function useEdition() {
  if (!loading) void refreshEdition();
  const has = (feature: LicenseFeature) => edition.value.features.includes(feature);
  return { edition, has, refresh: refreshEdition };
}

export function setEditionForTests(info: EditionInfo) {
  edition.value = info;
  loading = Promise.resolve();
}
