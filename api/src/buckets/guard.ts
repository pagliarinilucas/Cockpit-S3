// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { Perm } from '../types';

/** Um bucket só pode ser excluído pelo owner e quando estiver vazio. Pura. */
export function mayDeleteBucket(perm: Perm | null, isEmpty: boolean): boolean {
  return perm === 'owner' && isEmpty;
}
