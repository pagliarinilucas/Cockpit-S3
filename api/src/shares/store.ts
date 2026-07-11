import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db';
import { shares } from '../db/schema';
import type { Share, ShareStatus } from '../types';

type Row = typeof shares.$inferSelect;

/** base64url (sem +/=) de N bytes aleatórios. 32 bytes = 256 bits de entropia. */
function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Pura: um link é utilizável se não foi revogado e ainda não expirou. */
export function isUsable(row: { revoked: number; expiresAt: string }, nowIso: string): boolean {
  return !row.revoked && row.expiresAt > nowIso;
}

function statusOf(row: Row, nowIso: string): ShareStatus {
  if (row.revoked) return 'revoked';
  if (row.expiresAt <= nowIso) return 'expired';
  return 'active';
}

function toPublic(row: Row, nowIso: string): Share {
  return {
    token: row.token,
    key: row.key,
    bucketId: row.bucketId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revoked: row.revoked === 1,
    lockIp: row.lockIp === 1,
    boundIp: row.boundIp ?? null,
    status: statusOf(row, nowIso),
  };
}

export const sharesStore = {
  create(input: { bucketId: string; key: string; createdBy: string; ttlSec: number; lockIp: boolean }): Row {
    const now = new Date();
    const token = randomToken();
    db.insert(shares).values({
      token,
      bucketId: input.bucketId,
      key: input.key,
      createdBy: input.createdBy,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlSec * 1000).toISOString(),
      revoked: 0,
      lockIp: input.lockIp ? 1 : 0,
      boundIp: null,
    }).run();
    return this.get(token)!;
  },

  get(token: string): Row | null {
    return db.select().from(shares).where(eq(shares.token, token)).get() ?? null;
  },

  listByUser(username: string): Share[] {
    const nowIso = new Date().toISOString();
    return db.select().from(shares)
      .where(eq(shares.createdBy, username))
      .orderBy(desc(shares.createdAt))
      .all()
      .map((r) => toPublic(r, nowIso));
  },

  revoke(token: string): void {
    db.update(shares).set({ revoked: 1 }).where(eq(shares.token, token)).run();
  },

  /**
   * Grava o IP no 1º acesso (TOFU) de forma atômica: só escreve se bound_ip ainda é null.
   * Retorna o bound_ip efetivo após a operação (o valor já gravado, se houve corrida).
   */
  bindIpIfUnset(token: string, ip: string): string | null {
    db.update(shares).set({ boundIp: ip })
      .where(and(eq(shares.token, token), isNull(shares.boundIp)))
      .run();
    return this.get(token)?.boundIp ?? null;
  },
};
