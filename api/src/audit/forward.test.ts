// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { createHmac, randomUUID, generateKeyPairSync } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer, type AddressInfo } from 'node:net';

const DB = join(tmpdir(), `cockpit-audit-forward-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
delete process.env.COCKPIT_LICENSE_KEY;
delete process.env.COCKPIT_LICENSE_FILE;

let forward: typeof import('./forward');
let audit: typeof import('./store').audit;
let auditSettings: typeof import('./settings').auditSettings;
let license: typeof import('../license/service').license;
let licenseKey: string;

const RUN = randomUUID().slice(0, 8);

interface Captured { body: string; signature: string | null; authorization: string | null }

const received: Captured[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  await import('../db');
  forward = await import('./forward');
  ({ audit } = await import('./store'));
  ({ auditSettings } = await import('./settings'));
  const service = await import('../license/service');
  const key = await import('../license/key');
  ({ license } = service);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  service.setLicensePublicKeyForTests(publicKey);
  licenseKey = key.encodeLicense({
    v: 1, id: `fwd-${RUN}`, licensee: 'Teste', edition: 'pro',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
  }, privateKey);
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        body: await request.text(),
        signature: request.headers.get('x-cockpit-signature'),
        authorization: request.headers.get('authorization'),
      });
      return new Response('ok');
    },
  });
});

afterAll(() => {
  server.stop(true);
  auditSettings.update({ webhookUrl: '', webhookSecret: '', webhookBearer: '', syslogHost: '' });
  license.remove();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
});

const sample = {
  id: 7, action: 'upload', actor: 'ana', bucket: 'docs', target: 'relatório "final"].pdf', at: '2026-10-14T12:00:00.000Z',
};

describe('syslog RFC 5424', () => {
  it('formata PRI, versão, cabeçalho e dados estruturados escapados', () => {
    const line = forward.formatSyslogLine(sample, 'host-1', 4242);
    expect(line).toBe(
      '<110>1 2026-10-14T12:00:00.000Z host-1 cockpit-s3 4242 upload '
      + '[cockpit@32473 id="7" action="upload" actor="ana" bucket="docs" target="relatório \\"final\\"\\].pdf"] '
      + 'ana upload docs relatório "final"].pdf',
    );
  });

  it('troca campos vazios ou com espaço do cabeçalho por NILVALUE/sem espaço', () => {
    const line = forward.formatSyslogLine({ ...sample, action: '' }, 'meu host', 1);
    expect(line.split(' ').slice(2, 6)).toEqual(['meuhost', 'cockpit-s3', '1', '-']);
  });

  it('TCP usa octet counting', () => {
    expect(forward.frameSyslogTcp('<110>1 abc').toString()).toBe('10 <110>1 abc');
  });

  it('entrega por UDP e por TCP', async () => {
    license.install(licenseKey);
    const udp = createSocket('udp4');
    const udpMessage = new Promise<string>((resolve) => udp.once('message', (m) => resolve(m.toString())));
    await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve));
    auditSettings.update({ webhookUrl: '', syslogHost: '127.0.0.1', syslogPort: udp.address().port, syslogProtocol: 'udp' });
    const udpResult = await forward.sendTestEvent('tester');
    expect(udpResult.syslog).toEqual({ ok: true });
    expect(await udpMessage).toMatch(/^<110>1 \S+ \S+ cockpit-s3 \d+ test \[cockpit@32473 id="0" action="test" actor="tester"/);
    udp.close();

    let tcpData = '';
    const tcpReceived = new Promise<void>((resolve) => {
      const srv = createServer((socket) => socket.on('data', (d) => { tcpData += d.toString(); resolve(); srv.close(); socket.destroy(); }));
      srv.listen(0, '127.0.0.1', () => {
        auditSettings.update({ syslogProtocol: 'tcp', syslogPort: (srv.address() as AddressInfo).port });
        void forward.sendTestEvent('tcp-tester');
      });
    });
    await tcpReceived;
    expect(tcpData).toMatch(/^\d+ <110>1 .* actor="tcp-tester"/);
    auditSettings.update({ syslogHost: '' });
  });
});

describe('webhook SIEM', () => {
  it('assina o corpo com HMAC-SHA256 e envia bearer', async () => {
    license.install(licenseKey);
    received.length = 0;
    auditSettings.update({
      webhookUrl: `http://127.0.0.1:${server.port}/hook`, webhookSecret: 'segredo', webhookBearer: 'tok-1', syslogHost: '',
    });
    audit.log('download', `hook-${RUN}`, 'b', 'x.txt');
    await forward.flushForwardQueueForTests();
    expect(received.length).toBe(1);
    const got = received[0]!;
    expect(got.signature).toBe(`sha256=${createHmac('sha256', 'segredo').update(got.body).digest('hex')}`);
    expect(got.authorization).toBe('Bearer tok-1');
    const payload = JSON.parse(got.body) as { event: { actor: string; id: number } };
    expect(payload.event.actor).toBe(`hook-${RUN}`);
    expect(payload.event.id).toBeGreaterThan(0);
  });

  it('não encaminha sem licença nem quebra o log quando o destino falha', async () => {
    received.length = 0;
    license.remove();
    audit.log('download', `nolic-${RUN}`, 'b', 'y.txt');
    await forward.flushForwardQueueForTests();
    expect(received.length).toBe(0);

    license.install(licenseKey);
    auditSettings.update({ webhookUrl: 'http://127.0.0.1:1/unreachable', webhookSecret: '' });
    expect(() => audit.log('download', `fail-${RUN}`, 'b', 'z.txt')).not.toThrow();
    await forward.flushForwardQueueForTests();
    expect(audit.list({ actor: `fail-${RUN}` }).length).toBe(1);
  });
});
