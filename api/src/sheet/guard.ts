// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Uma pergunta só: este arquivo pode ser aberto no editor nesta instalação?
 *
 * O editor guarda o rascunho compartilhado no banco. Com KEK, cifrado; sem KEK,
 * em claro (ver store.ts). Gravar em claro o rascunho de um arquivo CIFRADO
 * seria vazar o conteúdo que a criptografia protege, então esse caso é barrado
 * aqui — e, na prática, ele também não teria como funcionar: sem a KEK o
 * servidor não consegue nem decifrar o arquivo para ler.
 *
 * Arquivo em texto claro não tem esse problema: o rascunho fica tão exposto
 * quanto o arquivo que qualquer um baixa do bucket.
 */
import { bucketCryptoStore, objectsStore } from '../objects/store';
import { getKekProvider } from '../crypto/kek';

export type OpenBlock = 'sealed' | null;

export function blockedReason(bucketId: string, key: string): OpenBlock {
  if (getKekProvider()) return null;
  const encryptedBucket = bucketCryptoStore.isEnabled(bucketId);
  const encryptedObject = objectsStore.get(bucketId, key) !== null;
  return encryptedBucket || encryptedObject ? 'sealed' : null;
}

export const canOpen = (bucketId: string, key: string): boolean =>
  blockedReason(bucketId, key) === null;
