import type { ZipEntry } from './zip';

export const TICKET_TTL_MS = 60_000;

export interface ZipTicketInput {
  bucketId: string;
  owner: string;
  filename: string;
  entries: ZipEntry[];
}

export interface ZipTicket extends ZipTicketInput {
  expiresAt: number;
}

const tickets = new Map<string, ZipTicket>();

function newId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sweep(now: number): void {
  for (const [id, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(id);
}

export const zipTickets = {
  create(input: ZipTicketInput, now = Date.now()): string {
    sweep(now);
    const id = newId();
    tickets.set(id, { ...input, expiresAt: now + TICKET_TTL_MS });
    return id;
  },

  consume(id: string, bucketId: string, now = Date.now()): ZipTicket | null {
    sweep(now);
    const ticket = tickets.get(id);
    if (!ticket || ticket.bucketId !== bucketId) return null;
    tickets.delete(id);
    return ticket;
  },

  size(): number { return tickets.size; },
};
