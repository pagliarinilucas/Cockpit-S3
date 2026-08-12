// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { randomUUID } from 'node:crypto';
import {
  S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

export interface DestConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  prefix: string;
}

export interface EscrowDest {
  put(key: string, body: Buffer): Promise<void>;
  list(): Promise<{ key: string; at: number; size: number }[]>;
  get(key: string): Promise<Buffer>;
  del(keys: string[]): Promise<void>;
  test(): Promise<void>;
}

export function s3Dest(cfg: DestConfig): EscrowDest {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
  });

  const put = async (key: string, body: Buffer): Promise<void> => {
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: cfg.prefix + key, Body: body }));
  };

  const list = async (): Promise<{ key: string; at: number; size: number }[]> => {
    const out: { key: string; at: number; size: number }[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token,
      }));
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        out.push({
          key: obj.Key.slice(cfg.prefix.length),
          at: obj.LastModified ? obj.LastModified.getTime() : 0,
          size: obj.Size ?? 0,
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    out.sort((a, b) => b.at - a.at);
    return out;
  };

  const get = async (key: string): Promise<Buffer> => {
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: cfg.prefix + key }));
    if (!res.Body) throw new Error('escrow_dest_empty_body');
    return Buffer.from(await res.Body.transformToByteArray());
  };

  const del = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const res = await client.send(new DeleteObjectsCommand({
        Bucket: cfg.bucket, Delete: { Objects: batch.map((k) => ({ Key: cfg.prefix + k })) },
      }));
      if (res.Errors && res.Errors.length > 0) {
        const failed = res.Errors.map((e) => e.Key ?? '?').join(', ');
        throw new Error(`escrow_dest_delete_failed: ${failed}`);
      }
    }
  };

  const test = async (): Promise<void> => {
    const probeKey = `.probe-${randomUUID()}`;
    await put(probeKey, Buffer.from('probe'));
    await del([probeKey]);
  };

  return { put, list, get, del, test };
}
