// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Ticket de uso único para abrir o WebSocket do editor. O browser não manda
 * header Authorization no handshake de WS, e token de acesso na URL vaza em log
 * de proxy — então a permissão é conferida no POST autenticado que cria o
 * ticket, e o ticket (curto, aleatório, descartável) é o que vai na URL.
 */
export const SHEET_TICKET_TTL_MS = 30_000;

export interface SheetTicket {
  bucketId: string;
  key: string;
  user: string;
  expiresAt: number;
}

const tickets = new Map<string, SheetTicket>();

function newId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sweep(now: number): void {
  for (const [id, t] of tickets) if (t.expiresAt <= now) tickets.delete(id);
}

export const sheetTickets = {
  create(input: { bucketId: string; key: string; user: string }, now = Date.now()): string {
    sweep(now);
    const id = newId();
    tickets.set(id, { ...input, expiresAt: now + SHEET_TICKET_TTL_MS });
    return id;
  },

  consume(id: string, now = Date.now()): SheetTicket | null {
    sweep(now);
    const t = tickets.get(id);
    if (!t) return null;
    tickets.delete(id);
    return t;
  },

  size(): number { return tickets.size; },
};
