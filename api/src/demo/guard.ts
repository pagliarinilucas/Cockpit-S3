// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { config } from '../config';
import { MAX_DEMO_SHARE_TTL_SECONDS, PROTECTED_DEMO_USERNAMES, demoRoleOf } from './catalog';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type MethodSelector = Method | 'WRITE';

interface BlockedRoute { methods: MethodSelector[]; path: RegExp }

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PROTECTED_USER_PATTERN = [...PROTECTED_DEMO_USERNAMES].join('|');

const BLOCKED_ROUTES: BlockedRoute[] = [
  { methods: ['POST'], path: /^\/api\/auth\/password$/ },
  { methods: ['POST'], path: /^\/api\/users\/[^/]+\/password$/ },
  { methods: ['DELETE'], path: new RegExp(`^/api/users/(${PROTECTED_USER_PATTERN})$`) },
  { methods: ['WRITE'], path: /^\/api\/connections(\/.*)?$/ },
  { methods: ['WRITE'], path: /^\/api\/clusters(\/.*)?$/ },
  { methods: ['GET'], path: /^\/api\/clusters\/[^/]+\/keys\/[^/]+\/secret$/ },
  { methods: ['GET'], path: /^\/api\/kek$/ },
  { methods: ['WRITE'], path: /^\/api\/escrow(\/.*)?$/ },
  { methods: ['WRITE'], path: /^\/api\/license$/ },
  { methods: ['WRITE'], path: /^\/api\/auth\/oidc\/(settings|test)$/ },
  { methods: ['WRITE'], path: /^\/api\/audit\/(settings|test-forward)$/ },
  { methods: ['WRITE'], path: /^\/api\/branding\/(settings|logo)$/ },
  { methods: ['POST'], path: /^\/api\/buckets$/ },
  { methods: ['DELETE'], path: /^\/api\/buckets\/[^/]+$/ },
  { methods: ['POST'], path: /^\/api\/buckets\/[^/]+\/encryption$/ },
];

const UPLOAD_ROUTE = /^\/api\/buckets\/[^/]+\/(objects|objects-encrypted|sheets)$/;
const PROTECTED_USER_ROUTE = new RegExp(`^/api/users/(${PROTECTED_USER_PATTERN})$`);

function normalizePath(pathname: string): string {
  const decoded = (() => { try { return decodeURIComponent(pathname); } catch { return pathname; } })();
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded;
}

function methodMatches(selectors: MethodSelector[], method: string): boolean {
  return selectors.some((selector) => (selector === 'WRITE' ? WRITE_METHODS.has(method) : selector === method));
}

export function isDemoBlockedRoute(method: string, pathname: string): boolean {
  const upperMethod = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const path = normalizePath(pathname);
  return BLOCKED_ROUTES.some((route) => methodMatches(route.methods, upperMethod) && route.path.test(path));
}

export function demoShareTtl(requestedSeconds: number): number {
  return config.demo.enabled ? Math.min(requestedSeconds, MAX_DEMO_SHARE_TTL_SECONDS) : requestedSeconds;
}

export interface DemoRejection { status: number; body: Record<string, unknown> }

async function changesProtectedRole(request: Request, username: string): Promise<boolean> {
  const payload = await request.clone().json().catch(() => null) as { role?: unknown } | null;
  return !!payload && payload.role !== undefined && payload.role !== demoRoleOf(username);
}

export async function demoRejection(request: Request): Promise<DemoRejection | null> {
  if (!config.demo.enabled) return null;
  const method = request.method.toUpperCase();
  const path = normalizePath(new URL(request.url).pathname);
  if (isDemoBlockedRoute(method, path)) return { status: 403, body: { error: 'demo_readonly' } };

  if (method === 'PATCH') {
    const protectedUser = PROTECTED_USER_ROUTE.exec(path)?.[1];
    if (protectedUser && await changesProtectedRole(request, protectedUser)) {
      return { status: 403, body: { error: 'demo_readonly' } };
    }
  }

  if (method === 'POST' && UPLOAD_ROUTE.test(path)) {
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > config.demo.maxUploadBytes) {
      return { status: 413, body: { error: 'demo_upload_too_large', maxBytes: config.demo.maxUploadBytes } };
    }
  }
  return null;
}
