// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { Perm } from './models';
import type { MessageKey } from '../i18n';

export const PERM_META: Record<Perm, { labelKey: MessageKey; cls: string; icon: string }> = {
  'owner': { labelKey: 'perm.badge.owner', cls: 'perm-owner', icon: 'shield' },
  'read-write': { labelKey: 'perm.badge.readWrite', cls: 'perm-rw', icon: 'upload' },
  'read-only': { labelKey: 'perm.badge.readOnly', cls: 'perm-ro', icon: 'eye' },
  'view-only': { labelKey: 'perm.badge.viewOnly', cls: 'perm-vo', icon: 'eye' },
};

export const PERM_CYCLE: (Perm | null)[] = [null, 'view-only', 'read-only', 'read-write', 'owner'];

export const PERM_OPTIONS: { value: Perm; labelKey: MessageKey; canKey: MessageKey }[] = [
  { value: 'view-only', labelKey: 'perm.option.viewOnly.label', canKey: 'perm.option.viewOnly.can' },
  { value: 'read-only', labelKey: 'perm.option.readOnly.label', canKey: 'perm.option.readOnly.can' },
  { value: 'read-write', labelKey: 'perm.option.readWrite.label', canKey: 'perm.option.readWrite.can' },
  { value: 'owner', labelKey: 'perm.option.owner.label', canKey: 'perm.option.owner.can' },
];

const DOWNLOAD_PERMS: Perm[] = ['read-only', 'read-write', 'owner'];

export function canDownloadPerm(perm: Perm | null | undefined): boolean {
  return !!perm && DOWNLOAD_PERMS.includes(perm);
}

export function canWritePerm(perm: Perm | null | undefined): boolean {
  return perm === 'read-write' || perm === 'owner';
}

export function effectivePerm(item: { perm?: Perm | null }, pathPerm: Perm | null): Perm | null {
  return item.perm !== undefined && item.perm !== null ? item.perm : pathPerm;
}
