import { describe, expect, test } from 'bun:test';
import { TICKET_TTL_MS, zipTickets } from './zip-tickets';

const base = {
  bucketId: 'conn1:fotos',
  owner: 'lucas',
  filename: 'fotos',
  entries: [{ key: 'p/a.txt', name: 'a.txt', size: 2 }],
};

describe('zipTickets', () => {
  test('consome uma vez e devolve o conteúdo', () => {
    const id = zipTickets.create(base);
    const t = zipTickets.consume(id, base.bucketId);
    expect(t?.filename).toBe('fotos');
    expect(t?.owner).toBe('lucas');
    expect(t?.entries).toEqual(base.entries);
  });

  test('uso único: segundo consumo falha', () => {
    const id = zipTickets.create(base);
    expect(zipTickets.consume(id, base.bucketId)).not.toBeNull();
    expect(zipTickets.consume(id, base.bucketId)).toBeNull();
  });

  test('expira depois do TTL', () => {
    const now = 1_000_000;
    const id = zipTickets.create(base, now);
    expect(zipTickets.consume(id, base.bucketId, now + TICKET_TTL_MS - 1)).not.toBeNull();

    const other = zipTickets.create(base, now);
    expect(zipTickets.consume(other, base.bucketId, now + TICKET_TTL_MS + 1)).toBeNull();
  });

  test('bucket diferente não consome', () => {
    const id = zipTickets.create(base);
    expect(zipTickets.consume(id, 'conn1:outro')).toBeNull();
    expect(zipTickets.consume(id, base.bucketId)).not.toBeNull();
  });

  test('ticket inexistente devolve null', () => {
    expect(zipTickets.consume('naoexiste', base.bucketId)).toBeNull();
  });

  test('ids são distintos e longos', () => {
    const ids = new Set(Array.from({ length: 50 }, () => zipTickets.create(base)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  test('expirados são varridos em vez de acumular', () => {
    const now = Date.now() + 10_000_000;
    for (let i = 0; i < 5; i++) zipTickets.create(base, now);
    expect(zipTickets.size()).toBeGreaterThanOrEqual(5);
    zipTickets.create(base, now + TICKET_TTL_MS + 1);
    expect(zipTickets.size()).toBe(1);
  });
});
