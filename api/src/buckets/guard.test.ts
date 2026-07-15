// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import { mayDeleteBucket } from './guard';

test('owner pode excluir bucket vazio', () => {
  expect(mayDeleteBucket('owner', true)).toBe(true);
});
test('owner não pode excluir bucket não vazio', () => {
  expect(mayDeleteBucket('owner', false)).toBe(false);
});
test('não-owner nunca pode excluir', () => {
  expect(mayDeleteBucket('read-write', true)).toBe(false);
  expect(mayDeleteBucket('read-only', true)).toBe(false);
  expect(mayDeleteBucket(null, true)).toBe(false);
});
