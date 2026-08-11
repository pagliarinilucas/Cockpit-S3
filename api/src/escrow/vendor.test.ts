// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import { vendorPubkey, vendorFingerprint } from './vendor';

test('sem pubkey pinada, retorna null', () => {
  expect(vendorPubkey()).toBeNull();
  expect(vendorFingerprint()).toBeNull();
});
