// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config } from './config';
import { bootstrap } from './bootstrap';
import { sessions } from './auth/sessions';
import { settingsStore } from './settings/store';
import { connectionsStore } from './connections/store';
import { s3, isValidConfig } from './storage/s3';
import { authRoutes } from './auth/routes';
import { userRoutes } from './users/routes';
import { groupRoutes } from './groups/routes';
import { storageRoutes } from './storage/routes';
import { connectionsRoutes } from './connections/routes';
import { activityRoutes } from './audit/routes';
import { clusterRoutes, configureClusterS3 } from './clusters/routes';
import { clustersStore } from './clusters/store';
import { shareRoutes } from './shares/routes';
import { publicShareRoutes } from './shares/public';
import { staticRoutes } from './web/static';
import { bootKekProvider, getKekProvider } from './crypto/kek';
import { escrowRoutes } from './escrow/routes';
import { sheetRoutes } from './sheet/routes';
import { startEscrowScheduler } from './escrow/backup';
import { startSessionReaper } from './sheet/session';

await bootstrap();
sessions.prune();

// Migrate the legacy single-config (or env seed) into a connection on first run.
if (connectionsStore.count() === 0) {
  const saved = settingsStore.getGarage();
  const envGarage = {
    endpoint: config.s3.endpoint ?? '', region: config.s3.region,
    accessKey: config.s3.accessKey ?? '', secretKey: config.s3.secretKey ?? '',
    buckets: config.s3.buckets,
  };
  const seed = saved ?? (isValidConfig(envGarage) ? envGarage : null);
  if (seed && isValidConfig(seed)) {
    connectionsStore.create({
      name: 'Garage', endpoint: seed.endpoint, region: seed.region || 'garage',
      accessKey: seed.accessKey, secretKey: seed.secretKey, buckets: seed.buckets ?? [],
    });
    console.log('migrou configuração existente do Garage para "Conexão: Garage"');
  }
}
s3.configureAll(connectionsStore.listFull());
for (const c of clustersStore.listFull()) configureClusterS3(c);

// Inicializa o provedor de KEK (criptografia em repouso), se configurado; no-op se não houver COCKPIT_KEK/COCKPIT_KEK_FILE.
bootKekProvider();
if (!getKekProvider()) {
  console.warn(
    '[crypto] sem KEK: o editor de planilhas guarda o rascunho da edição em texto '
    + 'claro no banco. Arquivo cifrado não abre no editor. Configure COCKPIT_KEK_FILE '
    + 'ou COCKPIT_KEK para cifrar o rascunho.',
  );
}
startEscrowScheduler();
startSessionReaper();

const app = new Elysia({ serve: { maxRequestBodySize: config.uploadMaxBytes } })
  .use(cors({
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') { set.status = 400; return { error: 'validation', detail: String((error as Error).message ?? error) }; }
    if (code === 'NOT_FOUND') { set.status = 404; return { error: 'not_found' }; }
    console.error('[error]', code, error);
    set.status = 500;
    return { error: 'internal' };
  })
  .get('/api/health', () => ({ ok: true, connections: connectionsStore.count(), s3: s3.hasAny() }))
  .use(authRoutes)
  .use(userRoutes)
  .use(groupRoutes)
  .use(storageRoutes)
  .use(sheetRoutes)
  .use(escrowRoutes)
  .use(connectionsRoutes)
  .use(clusterRoutes)
  .use(activityRoutes)
  .use(shareRoutes)         // authenticated share-link management (/api/shares)
  .use(publicShareRoutes)   // public, login-less share access (/api/share/:token) — before staticRoutes
  .use(staticRoutes)        // serves the SPA in single-container deploys (WEB_DIR set)
  .listen(config.port);

console.log(`Cockpit S3 API → http://localhost:${config.port}  (${connectionsStore.count()} conexão(ões), s3 ${s3.hasAny() ? 'ativo' : 'nenhuma'}${config.webDir ? ', servindo SPA' : ''})`);

export type App = typeof app;
