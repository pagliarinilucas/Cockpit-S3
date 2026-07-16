// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Upload/download cifrado em streaming, via URLs presigned internas + fetch do Bun
 * (o AWS SDK bufferiza/rejeita streams no Bun — validado em spike). Atomicidade:
 * PUT primeiro; metadata depois; compensação em falha. Nunca loga material de chave.
 */
import sodium from 'sodium-native';
import { s3 } from './s3';
import { getKekProvider } from '../crypto/kek';
import { encryptStream, decryptStream } from '../crypto/stream';
import { cipherBlobSize } from '../crypto/constants';
import { generateDek } from '../crypto/index';
import { objectsStore } from '../objects/store';
import { DEFAULT_ORG } from '../crypto/constants';

interface UploadArgs {
  cid: string; bucket: string; bucketId: string; key: string;
  sizePlain: number; contentType: string; body: ReadableStream<Uint8Array>;
}

export async function uploadEncrypted(a: UploadArgs): Promise<void> {
  const provider = getKekProvider();
  if (!provider) throw new Error('sealed_or_unconfigured');

  const dek = generateDek();
  try {
    const { wrapped, version } = provider.wrapWithCurrent(DEFAULT_ORG, dek);
    const s3Key = crypto.randomUUID();
    const { header, transform } = encryptStream(dek);
    const sizeCipher = cipherBlobSize(a.sizePlain);

    // guarda de tamanho: conta o plaintext ANTES de cifrar; se o cliente declarou um
    // sizePlain menor que o corpo real, o Content-Length trunca o PUT e commitaria um
    // objeto CORROMPIDO. O mismatch dispara aqui, falha o PUT e aciona a compensação.
    let counted = 0;
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) { counted += chunk.byteLength; ctrl.enqueue(chunk); },
      flush() { if (counted !== a.sizePlain) throw new Error(`size_mismatch_${counted}_${a.sizePlain}`); },
    });

    // 1) PUT streaming via presigned + fetch
    const url = await s3.presignPut(a.cid, a.bucket, s3Key, 'application/octet-stream');
    const res = await fetch(url, {
      method: 'PUT',
      body: a.body.pipeThrough(guard).pipeThrough(transform) as unknown as Bun.BodyInit,
      duplex: 'half',
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(sizeCipher) },
    });
    if (!res.ok) throw new Error(`s3_put_failed_${res.status}`);

    // 2) metadata atômica; retorna s3_key antigo (se overwrite)
    let oldS3Key: string | null = null;
    try {
      ({ oldS3Key } = objectsStore.upsertReturningOld({
        bucketId: a.bucketId, key: a.key, s3Key, dekWrapped: wrapped, kekVersion: version,
        streamHeader: header, sizePlain: a.sizePlain, sizeCipher, contentType: a.contentType,
      }));
    } catch (e) {
      // metadata falhou -> deleta o blob novo (sem órfão)
      await s3.removeKey(a.cid, a.bucket, s3Key).catch((err) =>
        console.error('[crypto] falha ao remover blob órfão', s3Key, (err as Error).message));
      throw e;
    }

    // 3) pós-commit: deletar blob antigo (overwrite cifrado) OU plaintext legado na mesma key
    if (oldS3Key && oldS3Key !== s3Key) {
      await s3.removeKey(a.cid, a.bucket, oldS3Key).catch((err) =>
        console.error('[crypto] falha ao remover blob órfão', oldS3Key, (err as Error).message));
    } else if (!oldS3Key) {
      // primeira vez cifrando esta key: se havia plaintext legado com o nome real, remover
      if (await s3.headExists(a.cid, a.bucket, a.key)) {
        await s3.removeKey(a.cid, a.bucket, a.key).catch((err) =>
          console.error('[crypto] falha ao remover blob órfão', a.key, (err as Error).message));
      }
    }
  } finally {
    sodium.sodium_memzero(dek);
  }
}

/** Devolve um ReadableStream de PLAINTEXT decifrado. memzero da DEK ao fim do stream. */
export async function downloadEncrypted(
  row: { s3Key: string; kekVersion: number; dekWrapped: Buffer; streamHeader: Buffer },
  cid: string, bucket: string,
): Promise<ReadableStream<Uint8Array>> {
  const provider = getKekProvider();
  if (!provider) throw new Error('sealed_or_unconfigured');
  const dek = provider.unwrapDek(DEFAULT_ORG, row.kekVersion, row.dekWrapped as Buffer);

  try {
    const url = await s3.presignGetRaw(cid, bucket, row.s3Key);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`s3_get_failed_${res.status}`);

    const plain = res.body.pipeThrough(decryptStream(dek, row.streamHeader as Buffer));
    // memzero quando o stream termina/aborta (sucesso: NÃO zera aqui, os hooks abaixo cuidam disso)
    return plain.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(c, ctrl) { ctrl.enqueue(c); },
      flush() { sodium.sodium_memzero(dek); },
      // @ts-expect-error 'cancel' não faz parte do tipo Transformer do lib.dom/bun-types,
      // mas o runtime do Bun invoca ao cancelar o lado readable (zera a DEK em abort).
      cancel() { sodium.sodium_memzero(dek); },
    }));
  } catch (e) {
    // falha antes de entregar o stream (presign, fetch ou init_pull do streamHeader corrompido)
    // -> zera a DEK aqui, pois os hooks do stream retornado nunca serão acionados
    sodium.sodium_memzero(dek);
    throw e;
  }
}
