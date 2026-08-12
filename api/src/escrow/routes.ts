// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { audit } from '../audit/store';
import { escrowStore } from './store';
import { s3Dest, type DestConfig } from './dest';
import { vendorPubkey, vendorFingerprint } from './vendor';
import { generateRecoveryCode } from '../crypto/recovery';
import { runBackupOnce } from './backup';
import { config } from '../config';

function publicClientDest(cfg: DestConfig | null): Omit<DestConfig, 'secretKey'> | null {
  if (!cfg) return null;
  const { endpoint, region, accessKey, bucket, prefix } = cfg;
  return { endpoint, region, accessKey, bucket, prefix };
}

function statusPayload() {
  const cfg = escrowStore.get();
  return {
    enabled: cfg.enabled,
    vendorAvailable: !!vendorPubkey(),
    vendorFingerprint: vendorFingerprint(),
    vendorEnabled: cfg.vendorEnabled,
    clientDest: publicClientDest(cfg.clientDest),
    recoverySet: !!cfg.recoverySecret,
    recoveryShown: cfg.recoveryShown,
    lastBackupAt: cfg.lastBackupAt,
    lastStatus: cfg.lastStatus,
    lastCount: cfg.lastCount,
  };
}

const destConfigSchema = t.Object({
  endpoint: t.String({ minLength: 1 }),
  region: t.String({ minLength: 1 }),
  accessKey: t.String({ minLength: 1 }),
  secretKey: t.String({ minLength: 1 }),
  bucket: t.String({ minLength: 1 }),
  prefix: t.String(),
});

export const escrowRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app

    .get('/escrow', ({ user, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      return statusPayload();
    })

    .post('/escrow/config', ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      escrowStore.setConfig(body);
      audit.log('key', user!.username, 'escrow', 'config atualizada');
      return statusPayload();
    }, { body: t.Object({
      enabled: t.Optional(t.Boolean()),
      clientDest: t.Optional(t.Union([destConfigSchema, t.Null()])),
      vendorEnabled: t.Optional(t.Boolean()),
    }) })

    .post('/escrow/recovery', ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      const manual = body?.manual?.trim();
      if (manual && manual.length < 12) { set.status = 400; return { error: 'weak_secret' }; }
      const code = manual || generateRecoveryCode();
      escrowStore.setRecovery(code);
      audit.log('key', user!.username, 'escrow', 'gerou código de recuperação');
      return { code };
    }, { body: t.Optional(t.Object({ manual: t.Optional(t.String()) })) })

    .post('/escrow/recovery/ack', ({ user, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      escrowStore.markShown();
      return { ok: true };
    })

    .post('/escrow/test', async ({ user, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      const cfg = escrowStore.get().clientDest;
      if (!cfg) { set.status = 400; return { error: 'no_dest' }; }
      try {
        await s3Dest(cfg).test();
        return { ok: true };
      } catch (e) {
        set.status = 502; return { error: String(e) };
      }
    })

    .post('/escrow/backup-now', async ({ user, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      const cfg = escrowStore.get();
      if (!cfg.enabled || !cfg.recoverySecret || !cfg.clientDest) { set.status = 400; return { error: 'not_configured' }; }
      if (cfg.vendorEnabled && !vendorPubkey()) { set.status = 400; return { error: 'vendor_unavailable' }; }
      try {
        const result = await runBackupOnce({
          dest: s3Dest(cfg.clientDest),
          dbPath: config.dbPath,
          recoverySecret: cfg.recoverySecret,
          vendorPub: cfg.vendorEnabled ? vendorPubkey() : null,
          now: Date.now(),
          spoolDir: config.escrowSpoolDir,
        });
        return { ok: true, key: result.key, removed: result.removed };
      } catch (e) {
        set.status = 500; return { error: String(e) };
      }
    }),
  );
