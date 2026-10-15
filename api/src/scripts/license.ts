// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { encodeLicense, privateKeyFromSeed, type Feature, type LicensePayload } from '../license/key';

const DEFAULT_KEY_FILE = join(homedir(), '.config', 'cockpit-s3', 'license-signing.key');
const signingKeyFile = process.env.COCKPIT_LICENSE_SIGNING_KEY ?? DEFAULT_KEY_FILE;

function usage(): never {
  console.log(`Usage:
  bun run license keygen
  bun run license issue --licensee "ACME Ltd" --email ops@acme.com [--edition pro|enterprise]
                        [--months 12 | --expires 2027-10-14] [--instance files.acme.com] [--feature white-label]

Signing key: ${signingKeyFile} (override with COCKPIT_LICENSE_SIGNING_KEY)`);
  process.exit(1);
}

function keygen() {
  if (existsSync(signingKeyFile)) {
    console.error(`Refusing to overwrite existing signing key at ${signingKeyFile}`);
    process.exit(1);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  mkdirSync(dirname(signingKeyFile), { recursive: true, mode: 0o700 });
  writeFileSync(signingKeyFile, seed.toString('base64') + '\n', { mode: 0o600 });
  console.log(`Private seed written to ${signingKeyFile} — back it up offline, never commit it.`);
  console.log(`Public key (paste into api/src/license/pubkey.ts):\n${raw.toString('base64')}`);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function issue(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      licensee: { type: 'string' },
      email: { type: 'string' },
      edition: { type: 'string', default: 'pro' },
      months: { type: 'string', default: '12' },
      expires: { type: 'string' },
      instance: { type: 'string' },
      feature: { type: 'string', multiple: true },
    },
  });
  if (!values.licensee) usage();
  if (values.edition !== 'pro' && values.edition !== 'enterprise') usage();
  const seed = Buffer.from(readFileSync(signingKeyFile, 'utf8').trim(), 'base64');
  const now = new Date();
  const expiresAt = values.expires ? new Date(values.expires) : addMonths(now, Number(values.months));
  if (Number.isNaN(expiresAt.getTime())) usage();
  const payload: LicensePayload = {
    v: 1,
    id: randomUUID(),
    licensee: values.licensee,
    ...(values.email ? { email: values.email } : {}),
    edition: values.edition,
    ...(values.instance ? { instance: values.instance } : {}),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(values.feature?.length ? { features: values.feature as Feature[] } : {}),
  };
  console.log(encodeLicense(payload, privateKeyFromSeed(seed)));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'keygen') keygen();
else if (command === 'issue') issue(rest);
else usage();
