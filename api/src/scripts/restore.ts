// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { s3Dest } from '../escrow/dest';
import { restoreFrom } from '../escrow/restore';

const endpoint = process.env.ESCROW_ENDPOINT;
const region = process.env.ESCROW_REGION || 'garage';
const accessKey = process.env.ESCROW_KEY;
const secretKey = process.env.ESCROW_SECRET;
const bucket = process.env.ESCROW_BUCKET;
const prefix = process.env.ESCROW_PREFIX || '';

const recoveryCode = process.env.ESCROW_RECOVERY_CODE;
const vendorPubB64 = process.env.ESCROW_VENDOR_PUBKEY;
const vendorPrivB64 = process.env.ESCROW_VENDOR_PRIVKEY;

const kekOutPath = process.env.COCKPIT_KEK_FILE;
const dbOutPath = process.env.DB_PATH;
const force = process.argv.includes('--force');

if (!endpoint || !accessKey || !secretKey || !bucket) {
  console.error('uso: defina ESCROW_ENDPOINT, ESCROW_KEY, ESCROW_SECRET, ESCROW_BUCKET (e ESCROW_REGION, ESCROW_PREFIX opcionais)');
  process.exit(1);
}

if (!kekOutPath || !dbOutPath) {
  console.error('uso: defina COCKPIT_KEK_FILE e DB_PATH (caminhos de saída para KEK e banco)');
  process.exit(1);
}

let opener: { recoverySecret: string } | { vendorPub: Buffer; vendorPriv: Buffer };
if (recoveryCode) {
  opener = { recoverySecret: recoveryCode };
} else if (vendorPubB64 && vendorPrivB64) {
  opener = { vendorPub: Buffer.from(vendorPubB64, 'base64'), vendorPriv: Buffer.from(vendorPrivB64, 'base64') };
} else {
  console.error('uso: defina ESCROW_RECOVERY_CODE (modo cliente) OU ESCROW_VENDOR_PUBKEY + ESCROW_VENDOR_PRIVKEY (modo vendor, base64)');
  process.exit(1);
}

const dest = s3Dest({ endpoint, region, accessKey, secretKey, bucket, prefix });

try {
  const result = await restoreFrom({ dest, opener, kekOutPath, dbOutPath, force });
  const kekMsg = result.restoredKek ? 'restaurada' : 'não presente no bundle';
  console.log(`Restaurado do snapshot ${result.from}; KEK ${kekMsg}; banco gravado em ${dbOutPath}.`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
