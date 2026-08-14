// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Upload/download cifrado em streaming. Upload usa multipart manual do S3 (partes
 * de tamanho fixo, upload sequencial e AWAITED antes de ler a próxima) — isso é o
 * que limita a memória: enquanto uma parte está subindo, o reader do stream de
 * origem fica parado, então o backpressure REALMENTE propaga até o corpo da
 * requisição HTTP de entrada (um `fetch` com `body: stream` direto para uma URL
 * presigned NÃO propaga esse backpressure no Bun — testado empiricamente: memória
 * cresce proporcionalmente ao tamanho do arquivo e uploads grandes derrubam o processo).
 * Download continua via GET presigned + streaming (sem esse problema, pois é o
 * cliente do lado de fora que dita a velocidade de leitura). Atomicidade do upload:
 * multipart completo primeiro; metadata depois; compensação (abort/delete) em falha.
 * Nunca loga material de chave.
 */
import sodium from 'sodium-native';
import { s3 } from './s3';
import { getKekProvider } from '../crypto/kek';
import { encryptStream, decryptStream } from '../crypto/stream';
import { cipherBlobSize } from '../crypto/constants';
import { generateDek } from '../crypto/index';
import { objectsStore } from '../objects/store';
import { DEFAULT_ORG } from '../crypto/constants';
import { join } from 'node:path';
import { statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { config } from '../config';

// Tamanho de parte do multipart: acima do mínimo do S3 (5 MiB, exceto a última
// parte) e pequeno o bastante para manter a memória limitada independente do
// tamanho total do arquivo.
const PART_SIZE = 16 * 1024 * 1024;

// Cadência de flush do spool em disco: empurra a cada 8 MiB em vez de a cada chunk
// (o corpo chega em pedaços pequenos; flush por chunk = milhares de syscalls por upload).
const SPOOL_FLUSH_INTERVAL = 8 * 1024 * 1024;

interface SpooledBody { sizePlain: number; body: ReadableStream<Uint8Array>; dispose: () => void; }

type Sink = ReturnType<ReturnType<typeof Bun.file>['writer']>;

/** Fecha o sink best-effort (nunca lança) — usado em todo caminho de saída do spool. */
const closeSink = async (s: Sink): Promise<void> => { try { await s.end(); } catch { /* fd já fechado */ } };

/**
 * Bufferiza o corpo da requisição em memória até `threshold` bytes; ao estourar,
 * derrama TUDO (o que já acumulou + o restante do stream) para um arquivo temp e
 * continua escrevendo em disco. Devolve a fonte (auto-pausada, sem 2ª cópia) +
 * dispose() que apaga o temp. Roteamento por bytes REAIS lidos, nunca pelo tamanho
 * declarado pelo cliente (Content-Length/​?size são auto-declarados e podem mentir).
 */
async function spoolRequestBody(
  stream: ReadableStream<Uint8Array>, threshold: number, spoolDir: string,
): Promise<SpooledBody> {
  const reader = stream.getReader();
  let mem: Uint8Array[] = [];
  let memBytes = 0;
  let tmp: string | null = null;
  let sink: Sink | null = null;
  let sinceFlush = 0;

  // Derrama o que já acumulou em `mem` pra disco, incrementalmente (shift + write),
  // liberando cada chunk assim que escrito — nunca mantém uma 2ª cópia inteira do
  // que já foi acumulado. Devolve o sink já aberto p/ os próximos chunks do stream.
  const spillMemToDisk = async (spillTmp: string): Promise<Sink> => {
    const s = Bun.file(spillTmp).writer();
    try {
      let acc = 0;
      // Passada única pra frente (nunca shift): shift() reindexa o array inteiro a
      // cada chamada -> O(n²) num buffer grande. `for..of` é O(n); libera as
      // referências dos chunks de uma vez (mem = []) ao final, não uma a uma.
      for (const ch of mem) {
        s.write(ch);
        acc += ch.byteLength;
        if (acc >= SPOOL_FLUSH_INTERVAL) { await s.flush(); acc = 0; }
      }
      mem = [];
      memBytes = 0;
      return s;
    } catch (e) {
      // Falha NO MEIO do derrame (write/flush): `s` nunca chega a ser atribuído à
      // variável `sink` do escopo externo, então ninguém mais fecharia esse fd.
      await closeSink(s);
      throw e;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (sink) {
        sink.write(value); sinceFlush += value.byteLength;
        if (sinceFlush >= SPOOL_FLUSH_INTERVAL) { await sink.flush(); sinceFlush = 0; }
      } else {
        mem.push(value); memBytes += value.byteLength;
        if (memBytes > threshold) {   // estourou o teto de memória → derrama tudo pra disco
          tmp = join(spoolDir, 'cockpit-upload-' + crypto.randomUUID());
          sink = await spillMemToDisk(tmp);
        }
      }
    }
  } catch (e) {
    // Qualquer falha a partir daqui (inclusive as que ocorrem DEPOIS de `tmp` já
    // atribuído) precisa apagar o temp -- como a função lança em vez de devolver
    // {dispose}, ninguém mais vai limpar esse arquivo.
    if (sink) await closeSink(sink);
    if (tmp) rmSync(tmp, { force: true });
    throw e;
  }

  if (sink) {
    await closeSink(sink);
    try {
      const sizePlain = statSync(tmp!).size;
      const body = Bun.file(tmp!).stream();
      return { sizePlain, body, dispose: () => rmSync(tmp!, { force: true }) };
    } catch (e) {
      rmSync(tmp!, { force: true });
      throw e;
    }
  }
  const chunks = mem;   // fonte auto-pausada, sem concat (1 cópia = os próprios chunks)
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } });
  return { sizePlain: memBytes, body, dispose: () => {} };
}

/**
 * Ponto de entrada seguro p/ upload cifrado a partir do corpo cru de uma requisição:
 * cuida do spool (memória/disco) + dispose do temp, então nenhuma rota precisa
 * reimplementar esse acoplamento (é o que motivou o vazamento de temp em erro, FIX #1).
 */
export async function uploadEncryptedFromRequest(a: {
  cid: string; bucket: string; bucketId: string; key: string; contentType: string; body: ReadableStream<Uint8Array>;
}): Promise<void> {
  const spooled = await spoolRequestBody(a.body, config.uploadSpoolThreshold, config.uploadSpoolDir || tmpdir());
  try {
    await uploadEncrypted({
      cid: a.cid, bucket: a.bucket, bucketId: a.bucketId, key: a.key,
      sizePlain: spooled.sizePlain, contentType: a.contentType, body: spooled.body,
    });
  } finally {
    spooled.dispose();
  }
}

interface UploadArgs {
  cid: string; bucket: string; bucketId: string; key: string;
  sizePlain: number; contentType: string; body: ReadableStream<Uint8Array>;
}

/**
 * CONTRATO: `a.body` precisa ser um stream LIMITADO/auto-paceado (arquivo em disco
 * ou buffer em memória) — esta função não faz spool. Corpo cru de requisição HTTP
 * (que pode não propagar backpressure e crescer sem limite) DEVE passar antes por
 * `uploadEncryptedFromRequest`, que faz o spool memória/disco antes de chamar esta.
 * Exportada porque os testes (crypto-pipeline.test.ts, load.test.ts) chamam direto.
 */
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

    // 1) upload multipart manual: lê o ciphertext em partes de tamanho fixo e
    // aguarda cada UploadPart antes de ler a próxima -> memória limitada a ~1 parte,
    // independente do tamanho do arquivo ou da velocidade do cliente.
    const uploadId = await s3.createMultipart(a.cid, a.bucket, s3Key, 'application/octet-stream');
    const parts: { ETag: string; PartNumber: number }[] = [];
    try {
      const reader = a.body.pipeThrough(guard).pipeThrough(transform).getReader();
      let bufs: Uint8Array[] = [];
      let buflen = 0;
      let partNumber = 1;

      const flushPart = async (last: boolean) => {
        if (!last && buflen < PART_SIZE) return;
        if (buflen === 0) return; // nada acumulado (só ocorre se last e vazio)
        const body = buflen === bufs[0]?.byteLength && bufs.length === 1
          ? bufs[0]
          : Buffer.concat(bufs.map((b) => Buffer.from(b)), buflen);
        const part = await s3.uploadPart(a.cid, a.bucket, s3Key, uploadId, partNumber, body);
        parts.push(part);
        partNumber++;
        bufs = [];
        buflen = 0;
        // Memória já é limitada pelo spool em disco (o corpo vira arquivo temp) + o buffer
        // de uma única parte; não é preciso forçar GC por parte (um Bun.gc(true) síncrono aqui
        // travaria o event loop a cada 16 MiB, afetando todas as requisições concorrentes).
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bufs.push(value);
        buflen += value.byteLength;
        while (buflen >= PART_SIZE) await flushPart(false);
      }
      await flushPart(true); // remanescente final (pode ser < 5 MiB, S3 permite na última parte)

      if (parts.length === 0) {
        // arquivo de 0 bytes: multipart exige ao menos 1 parte -> sobe uma parte vazia
        const part = await s3.uploadPart(a.cid, a.bucket, s3Key, uploadId, 1, new Uint8Array(0));
        parts.push(part);
      }

      await s3.completeMultipart(a.cid, a.bucket, s3Key, uploadId, parts);
    } catch (e) {
      await s3.abortMultipart(a.cid, a.bucket, s3Key, uploadId).catch((err) =>
        console.error('[crypto] falha ao abortar multipart', s3Key, (err as Error).message));
      throw e;
    }

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

/**
 * Tamanho REAL de um objeto (plaintext se cifrado, senão HEAD no S3). Detecção de
 * 404 ESTRUTURADA (nome do erro / status HTTP), não por match de string no texto
 * do erro — mais robusta a mudanças de mensagem entre SDKs/versões. Erros que não
 * sejam not-found são repropagados (senão subcontaria o total em quem soma tamanhos).
 * `null` = objeto não encontrado (404): o chamador decide se isso conta como 0 ou
 * se esconde o tamanho (ex.: metadata de share público não deve mostrar "0 B").
 */
export async function resolveObjectSize(cid: string, bucket: string, bucketId: string, key: string): Promise<number | null> {
  const row = objectsStore.get(bucketId, key);
  if (row) return row.sizePlain;
  try {
    return (await s3.head(cid, bucket, key)).size ?? 0;
  } catch (e) {
    const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (n?.name === 'NotFound' || n?.name === 'NoSuchKey' || n?.$metadata?.httpStatusCode === 404) return null;
    throw e;
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
