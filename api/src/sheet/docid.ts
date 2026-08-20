// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Id do documento vivo. Fica separado do modelo porque depende do node:crypto —
 * e o modelo (junto com styles, theme, conditional e layout) é compartilhado com
 * o cliente, que roda no browser.
 */
import { createHash } from 'node:crypto';

/**
 * Separador NUL entre bucket e key: não aparece em nenhum dos dois, então duas
 * combinações diferentes nunca colidem. Escrito com fromCharCode porque um NUL
 * literal no fonte é invisível.
 */
const SEP = String.fromCharCode(0);

/** Muda se o arquivo for movido/renomeado — ver a guarda de exclusão. */
export const docIdFor = (bucketId: string, key: string): string =>
  createHash('sha256').update(bucketId + SEP + key).digest('hex');
