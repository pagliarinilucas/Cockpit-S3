// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config';
import type { AccessClaims, Role } from '../types';

const secret = new TextEncoder().encode(config.accessSecret);
const ISSUER = 'cockpit-s3';
const AUDIENCE = 'cockpit-s3-spa';

/** Sign a short-lived access token carrying the token version (`ver`). */
export async function signAccess(username: string, role: Role, ver: number): Promise<string> {
  return new SignJWT({ role, ver })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(username)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${config.accessTtl}s`)
    .sign(secret);
}

export async function verifyAccess(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== 'string' || typeof payload.ver !== 'number' || typeof payload.role !== 'string') {
      return null;
    }
    return { sub: payload.sub, role: payload.role as Role, ver: payload.ver };
  } catch {
    return null; // expired / bad signature / malformed
  }
}

/** Opaque refresh token: 256 bits of entropy, base64url. Stored only as a hash. */
export function newRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** SHA-256 hex of the refresh token — what we persist (never the token itself). */
export function hashRefresh(token: string): string {
  const h = new Bun.CryptoHasher('sha256');
  h.update(token);
  return h.digest('hex');
}
