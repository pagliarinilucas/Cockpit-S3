import type { Perm } from '../types';

/** Um bucket só pode ser excluído pelo owner e quando estiver vazio. Pura. */
export function mayDeleteBucket(perm: Perm | null, objects: number): boolean {
  return perm === 'owner' && objects === 0;
}
