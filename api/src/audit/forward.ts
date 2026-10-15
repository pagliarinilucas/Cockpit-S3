// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createHmac } from 'node:crypto';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect, isIPv6, type Socket as TcpSocket } from 'node:net';
import { hostname } from 'node:os';
import { license } from '../license/service';
import { auditSettings, type AuditSettings } from './settings';

export interface ForwardedEvent {
  id: number;
  action: string;
  actor: string;
  bucket: string;
  target: string;
  at: string;
}

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ForwardTestResult {
  webhook: ForwardResult | null;
  syslog: ForwardResult | null;
}

export const FORWARD_QUEUE_LIMIT = 1000;
const SEND_TIMEOUT_MS = 5000;
const SYSLOG_FACILITY_LOG_AUDIT = 13;
const SYSLOG_SEVERITY_INFO = 6;
const SYSLOG_APP_NAME = 'cockpit-s3';
const SYSLOG_ENTERPRISE_ID = 'cockpit@32473';
const SIGNATURE_HEADER = 'X-Cockpit-Signature';

const queue: ForwardedEvent[] = [];
let droppedCount = 0;
let draining = false;
let udpSocket: { socket: UdpSocket; family: 'udp4' | 'udp6' } | null = null;
let tcpConnection: { socket: TcpSocket; key: string } | null = null;

function syslogHeaderToken(value: string, maxLength: number): string {
  const printable = value.replace(/[^\x21-\x7e]/g, '').slice(0, maxLength);
  return printable || '-';
}

function escapeStructuredValue(value: string): string {
  return value.replace(/[\\"\]]/g, (ch) => `\\${ch}`).replace(/[\r\n]+/g, ' ');
}

export function formatSyslogLine(event: ForwardedEvent, host = hostname(), pid = process.pid): string {
  const priority = SYSLOG_FACILITY_LOG_AUDIT * 8 + SYSLOG_SEVERITY_INFO;
  const params = (['id', 'action', 'actor', 'bucket', 'target'] as const)
    .map((name) => `${name}="${escapeStructuredValue(String(event[name]))}"`)
    .join(' ');
  const message = `${event.actor} ${event.action} ${event.bucket} ${event.target}`.replace(/[\r\n]+/g, ' ').trim();
  return [
    `<${priority}>1`,
    syslogHeaderToken(event.at, 64),
    syslogHeaderToken(host, 255),
    SYSLOG_APP_NAME,
    syslogHeaderToken(String(pid), 128),
    syslogHeaderToken(event.action, 32),
    `[${SYSLOG_ENTERPRISE_ID} ${params}]`,
    message,
  ].join(' ');
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function webhookPayload(event: ForwardedEvent): string {
  return JSON.stringify({ source: SYSLOG_APP_NAME, type: 'audit', event });
}

async function sendWebhook(config: AuditSettings, event: ForwardedEvent): Promise<ForwardResult> {
  const body = webhookPayload(event);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Cockpit-S3-Audit' };
  if (config.webhookBearer) headers['Authorization'] = `Bearer ${config.webhookBearer}`;
  if (config.webhookSecret) headers[SIGNATURE_HEADER] = signBody(body, config.webhookSecret);
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name === 'TimeoutError' ? 'timeout' : e.message : 'error' };
  }
}

function udpFor(host: string): UdpSocket {
  const family = isIPv6(host) ? 'udp6' : 'udp4';
  if (udpSocket && udpSocket.family === family) return udpSocket.socket;
  udpSocket?.socket.close();
  const socket = createSocket(family);
  socket.on('error', () => {
    if (udpSocket?.socket === socket) udpSocket = null;
    try { socket.close(); } catch { return; }
  });
  socket.unref();
  udpSocket = { socket, family };
  return socket;
}

function sendSyslogUdp(host: string, port: number, line: string): Promise<ForwardResult> {
  return new Promise((resolve) => {
    try {
      udpFor(host).send(Buffer.from(line, 'utf8'), port, host, (err) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : 'error' });
    }
  });
}

function dropTcpConnection(): void {
  tcpConnection?.socket.destroy();
  tcpConnection = null;
}

function tcpFor(host: string, port: number): Promise<TcpSocket> {
  const key = `${host}:${port}`;
  if (tcpConnection && tcpConnection.key === key && !tcpConnection.socket.destroyed) {
    return Promise.resolve(tcpConnection.socket);
  }
  dropTcpConnection();
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, SEND_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.unref();
      tcpConnection = { socket, key };
      resolve(socket);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      if (tcpConnection?.socket === socket) tcpConnection = null;
      reject(err);
    });
    socket.on('close', () => { if (tcpConnection?.socket === socket) tcpConnection = null; });
  });
}

export function frameSyslogTcp(line: string): Buffer {
  const payload = Buffer.from(line, 'utf8');
  return Buffer.concat([Buffer.from(`${payload.length} `, 'ascii'), payload]);
}

async function sendSyslogTcp(host: string, port: number, line: string): Promise<ForwardResult> {
  try {
    const socket = await tcpFor(host, port);
    await new Promise<void>((resolve, reject) => {
      socket.write(frameSyslogTcp(line), (err) => (err ? reject(err) : resolve()));
    });
    return { ok: true };
  } catch (e) {
    dropTcpConnection();
    return { ok: false, error: e instanceof Error ? e.message : 'error' };
  }
}

function sendSyslog(config: AuditSettings, event: ForwardedEvent): Promise<ForwardResult> {
  const line = formatSyslogLine(event);
  return config.syslogProtocol === 'tcp'
    ? sendSyslogTcp(config.syslogHost, config.syslogPort, line)
    : sendSyslogUdp(config.syslogHost, config.syslogPort, line);
}

function hasTargets(config: AuditSettings): boolean {
  return !!config.webhookUrl || !!config.syslogHost;
}

async function deliver(config: AuditSettings, event: ForwardedEvent): Promise<ForwardTestResult> {
  const [webhook, syslog] = await Promise.all([
    config.webhookUrl ? sendWebhook(config, event) : Promise.resolve(null),
    config.syslogHost ? sendSyslog(config, event) : Promise.resolve(null),
  ]);
  return { webhook, syslog };
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (let event = queue.shift(); event; event = queue.shift()) {
      const config = auditSettings.get();
      if (!hasTargets(config) || !license.has('audit-export')) continue;
      const result = await deliver(config, event);
      if (result.webhook && !result.webhook.ok) console.warn('[audit] falha no webhook SIEM:', result.webhook.error);
      if (result.syslog && !result.syslog.ok) console.warn('[audit] falha no syslog SIEM:', result.syslog.error);
    }
  } catch (e) {
    console.warn('[audit] encaminhamento interrompido:', e);
  } finally {
    draining = false;
    if (queue.length) setTimeout(() => { void drain(); }, 1000).unref();
  }
}

export function forwardAuditEvent(event: ForwardedEvent): void {
  try {
    if (!hasTargets(auditSettings.get()) || !license.has('audit-export')) return;
    if (queue.length >= FORWARD_QUEUE_LIMIT) {
      queue.shift();
      droppedCount++;
    }
    queue.push(event);
    queueMicrotask(() => { void drain(); });
  } catch (e) {
    console.warn('[audit] encaminhamento ignorado:', e);
  }
}

export function sendTestEvent(actor: string): Promise<ForwardTestResult> {
  const event: ForwardedEvent = {
    id: 0, action: 'test', actor, bucket: '—', target: 'Evento de teste do Cockpit S3', at: new Date().toISOString(),
  };
  return deliver(auditSettings.get(), event);
}

export function forwardStats(): { queued: number; dropped: number } {
  return { queued: queue.length, dropped: droppedCount };
}

export async function flushForwardQueueForTests(): Promise<void> {
  while (queue.length || draining) await new Promise((r) => setTimeout(r, 5));
}
