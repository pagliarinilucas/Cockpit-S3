// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { Perm } from './models';

export const PERM_META: Record<Perm, { label: string; cls: string; icon: string }> = {
  'owner': { label: 'OWNER', cls: 'perm-owner', icon: 'shield' },
  'read-write': { label: 'READ/WRITE', cls: 'perm-rw', icon: 'upload' },
  'read-only': { label: 'READ-ONLY', cls: 'perm-ro', icon: 'eye' },
  'view-only': { label: 'VIEW-ONLY', cls: 'perm-vo', icon: 'eye' },
};

export const PERM_CYCLE: (Perm | null)[] = [null, 'view-only', 'read-only', 'read-write', 'owner'];
