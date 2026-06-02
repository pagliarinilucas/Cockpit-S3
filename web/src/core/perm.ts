import type { Perm } from './models';

export const PERM_META: Record<Perm, { label: string; cls: string; icon: string }> = {
  'owner': { label: 'OWNER', cls: 'perm-owner', icon: 'shield' },
  'read-write': { label: 'READ/WRITE', cls: 'perm-rw', icon: 'upload' },
  'read-only': { label: 'READ-ONLY', cls: 'perm-ro', icon: 'eye' },
};

export const PERM_CYCLE: (Perm | null)[] = [null, 'read-only', 'read-write', 'owner'];
