// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Cifra/decifra em streaming com crypto_secretstream, chunks de 1 MiB.
 * Chunking com LOOKAHEAD de 1 chunk: o último chunk não-vazio recebe TAG_FINAL,
 * então nunca há chunk final vazio à toa (exceto arquivo de 0 bytes). Isso mantém
 * o tamanho do blob == cipherBlobSize(size_plain). Backpressure de ponta a ponta:
 * o transform segura no máximo ~2 MiB (chunk pendente + chunk chegando).
 */
import sodium from 'sodium-native';
import { STATEBYTES, HEADERBYTES, ABYTES, CHUNK_SIZE, TAG_MESSAGE, TAG_FINAL } from './constants';

export function encryptStream(dek: Buffer): { header: Buffer; transform: TransformStream<Uint8Array, Uint8Array> } {
  const state = Buffer.alloc(STATEBYTES);
  const header = Buffer.alloc(HEADERBYTES);
  sodium.crypto_secretstream_xchacha20poly1305_init_push(state, header, dek);

  let pending: Buffer | null = null; // chunk cheio segurado (lookahead)
  let buf: Buffer[] = [];
  let buflen = 0;

  const emit = (ctrl: TransformStreamDefaultController<Uint8Array>, plain: Buffer, tag: number) => {
    const c = Buffer.alloc(plain.length + ABYTES);
    sodium.crypto_secretstream_xchacha20poly1305_push(state, c, plain, null, tag);
    ctrl.enqueue(new Uint8Array(c));
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(part, ctrl) {
      buf.push(Buffer.from(part));
      buflen += part.byteLength;
      while (buflen >= CHUNK_SIZE) {
        const whole = Buffer.concat(buf, buflen);
        const chunk = whole.subarray(0, CHUNK_SIZE);
        const rest = whole.subarray(CHUNK_SIZE);
        buf = rest.length ? [Buffer.from(rest)] : [];
        buflen = rest.length;
        if (pending) emit(ctrl, pending, TAG_MESSAGE); // o anterior não era o último
        pending = Buffer.from(chunk);
      }
    },
    flush(ctrl) {
      if (pending) emit(ctrl, pending, buflen ? TAG_MESSAGE : TAG_FINAL);
      const last = Buffer.concat(buf, buflen);
      if (buflen || !pending) emit(ctrl, last, TAG_FINAL); // último (talvez vazio) é FINAL
    },
  });

  return { header, transform };
}

export function decryptStream(dek: Buffer, header: Buffer): TransformStream<Uint8Array, Uint8Array> {
  const state = Buffer.alloc(STATEBYTES);
  sodium.crypto_secretstream_xchacha20poly1305_init_pull(state, header, dek);

  let buf: Buffer[] = [];
  let buflen = 0;
  const ENC = CHUNK_SIZE + ABYTES;
  const tagOut = Buffer.alloc(1);

  const pull = (ctrl: TransformStreamDefaultController<Uint8Array>, cipher: Buffer) => {
    const m = Buffer.alloc(cipher.length - ABYTES);
    sodium.crypto_secretstream_xchacha20poly1305_pull(state, m, tagOut, cipher, null);
    ctrl.enqueue(new Uint8Array(m));
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(part, ctrl) {
      buf.push(Buffer.from(part));
      buflen += part.byteLength;
      // segura pelo menos um bloco (o último pode ser menor que ENC)
      while (buflen > ENC) {
        const whole = Buffer.concat(buf, buflen);
        pull(ctrl, whole.subarray(0, ENC));
        const rest = whole.subarray(ENC);
        buf = rest.length ? [Buffer.from(rest)] : [];
        buflen = rest.length;
      }
    },
    flush(ctrl) {
      if (buflen) pull(ctrl, Buffer.concat(buf, buflen));
    },
  });
}
