// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { readFileSync } from 'node:fs';

/** Central env config. Fails fast on missing critical secrets in production. */
const env = (k: string, def?: string) => process.env[k] ?? def;

const isProd = env('NODE_ENV') === 'production';

function requiredSecret(): string {
  const s = env('ACCESS_TOKEN_SECRET');
  if (s && s.length >= 32) return s;
  if (isProd) {
    console.error('FATAL: ACCESS_TOKEN_SECRET ausente ou curto (>=32 chars) em produção.');
    process.exit(1);
  }
  // Dev fallback: ephemeral secret (tokens invalidam ao reiniciar — só dev).
  const gen = crypto.randomUUID() + crypto.randomUUID();
  console.warn('⚠  ACCESS_TOKEN_SECRET não definido — usando segredo efêmero de dev.');
  return gen;
}

export const config = {
  isProd,
  port: Number(env('PORT', '3000')),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:4200')!,

  accessSecret: requiredSecret(),
  accessTtl: Number(env('ACCESS_TOKEN_TTL', '900')),        // 15 min
  refreshTtl: Number(env('REFRESH_TOKEN_TTL', '2592000')),  // 30 dias
  cookieSecure: env('COOKIE_SECURE', isProd ? 'true' : 'false') === 'true',
  refreshCookie: 'cs3_rt',
  refreshCookiePath: '/api/auth',

  dbPath: env('DB_PATH', './data/cockpit.sqlite')!,

  // When set, the API also serves the built SPA from this dir (single-container deploy).
  webDir: env('WEB_DIR', '')!,

  // bootstrap admin (criado se não houver nenhum usuário)
  adminUser: env('ADMIN_USERNAME', 'admin')!,
  adminPass: env('ADMIN_PASSWORD'),  // se ausente, gera uma e imprime no boot

  // login throttling
  loginMaxAttempts: Number(env('LOGIN_MAX_ATTEMPTS', '8')),
  loginWindowMs: Number(env('LOGIN_WINDOW_MS', '300000')),  // 5 min

  // Garage / S3
  s3: {
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'garage')!,
    accessKey: env('S3_ACCESS_KEY'),
    secretKey: env('S3_SECRET_KEY'),
    // buckets que o app gerencia (csv). vazio = lista via S3 ListBuckets.
    buckets: (env('BUCKETS', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  // Criptografia at-rest (Fase 1): KEK via arquivo (preferido) ou base64 em env.
  kekFile: env('COCKPIT_KEK_FILE'),
  kek: env('COCKPIT_KEK'),
  // Teto de corpo de upload (Bun default é 128 MiB). Default 6 GiB p/ cobrir o
  // teto de single-PUT do S3 (~5 GiB) em objetos cifrados.
  uploadMaxBytes: Number(env('UPLOAD_MAX_BYTES', String(6 * 1024 * 1024 * 1024))),
  // Teto do upload LEGADO (multipart, bufferizado em memória via file.arrayBuffer()).
  // O teto global acima (uploadMaxBytes) cobre a rota cifrada em streaming; este é bem
  // menor pois cada byte aceito aqui vira RSS do processo. Default 128 MiB.
  uploadMaxInMemoryBytes: Number(env('UPLOAD_MAX_INMEMORY_BYTES', String(128 * 1024 * 1024))),
};

/** Lê a KEK bruta (32 bytes) de COCKPIT_KEK_FILE ou COCKPIT_KEK (base64). null se ausente. */
export function readKekBytes(): Buffer | null {
  if (config.kekFile) {
    const raw = readFileSync(config.kekFile);
    // aceita 32 bytes crus OU base64 de 32 bytes
    if (raw.length === 32) return raw;
    const b64 = Buffer.from(raw.toString('utf8').trim(), 'base64');
    if (b64.length === 32) return b64;
    throw new Error('COCKPIT_KEK_FILE deve conter 32 bytes (crus ou base64)');
  }
  if (config.kek) {
    const b = Buffer.from(config.kek.trim(), 'base64');
    if (b.length !== 32) throw new Error('COCKPIT_KEK deve ser base64 de 32 bytes');
    return b;
  }
  return null;
}

