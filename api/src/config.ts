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

  zipMaxEntries: Number(env('ZIP_MAX_ENTRIES', '20000')),

  // Garage / S3
  s3: {
    endpoint: env('S3_ENDPOINT'),
    region: env('S3_REGION', 'garage')!,
    accessKey: env('S3_ACCESS_KEY'),
    secretKey: env('S3_SECRET_KEY'),
    // buckets que o app gerencia (csv). vazio = lista via S3 ListBuckets.
    buckets: (env('BUCKETS', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

