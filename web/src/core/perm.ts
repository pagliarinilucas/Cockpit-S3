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

export const PERM_OPTIONS: { value: Perm; label: string; can: string }[] = [
  { value: 'view-only', label: 'Só ver (sem download)', can: 'Visualiza e faz preview, mas NÃO baixa nem envia.' },
  { value: 'read-only', label: 'Ver e baixar', can: 'Visualiza e baixa. Não envia nem apaga.' },
  { value: 'read-write', label: 'Ver, baixar e enviar', can: 'Visualiza, baixa, envia e apaga.' },
  { value: 'owner', label: 'Dono (controle total)', can: 'Controle total sobre a pasta.' },
];
