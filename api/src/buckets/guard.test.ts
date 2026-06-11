import { test, expect } from 'bun:test';
import { mayDeleteBucket } from './guard';

test('owner pode excluir bucket vazio', () => {
  expect(mayDeleteBucket('owner', 0)).toBe(true);
});
test('owner não pode excluir bucket com objetos', () => {
  expect(mayDeleteBucket('owner', 3)).toBe(false);
});
test('não-owner nunca pode excluir', () => {
  expect(mayDeleteBucket('read-write', 0)).toBe(false);
  expect(mayDeleteBucket('read-only', 0)).toBe(false);
  expect(mayDeleteBucket(null, 0)).toBe(false);
});
