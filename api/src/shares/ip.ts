// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
type Headers = Record<string, string | undefined>;
interface RequestIPServer { requestIP?: (req: Request) => { address?: string } | null }

/**
 * IP do cliente para a trava de link público. Assume proxy confiável (Dokploy/Traefik)
 * setando x-forwarded-for. Prioriza o 1º item de XFF, senão x-real-ip, senão o socket.
 */
export function clientIp(headers: Headers, server: RequestIPServer | null | undefined, request: Request): string {
  const xff = headers['x-forwarded-for'];
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers['x-real-ip']?.trim();
  if (real) return real;
  return server?.requestIP?.(request)?.address ?? '';
}
