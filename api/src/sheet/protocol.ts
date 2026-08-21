// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Formato do fio do WebSocket: tipos de frame, montagem, decodificação e envio.
 * Não importa nada com estado (sessão, banco) de propósito — assim é testável
 * sozinho, e testar o protocolo não inicializa o banco por tabela. O que chega
 * do socket é dado não confiável: tipo, tamanho e conteúdo são validados aqui.
 */

export const FRAME_UPDATE = 1;
export const FRAME_PRESENCE = 2;
export const FRAME_CONTROL = 3;

/** Prefixa o byte de tipo no payload. */
export function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

export const controlFrame = (msg: unknown): Uint8Array =>
  frame(FRAME_CONTROL, new TextEncoder().encode(JSON.stringify(msg)));

export type FrameAction =
  | { kind: 'update'; payload: Uint8Array }
  | { kind: 'presence'; payload: Uint8Array }
  | { kind: 'save' }
  | { kind: 'ignore' };

/** Normaliza o que o runtime entrega no handler de mensagem para bytes. */
export function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof raw === 'string') return new TextEncoder().encode(raw);
  return null;
}

/** Socket cru (Bun) por trás do wrapper do Elysia. */
export interface RawSocket {
  send(data: Uint8Array): unknown;
}

/**
 * Envia bytes SEM passar pelo `ws.send` do Elysia: ele trata Uint8Array como
 * objeto qualquer e faz JSON.stringify (só `Buffer.isBuffer` escapa), o que
 * transforma o frame binário no texto {"0":1,...} e o cliente descarta.
 */
export const binarySend = (ws: { raw: RawSocket }) => (frame: Uint8Array): void => {
  ws.raw.send(frame);
};

export function decodeFrame(raw: unknown): FrameAction {
  const bytes = toBytes(raw);
  if (!bytes || bytes.byteLength < 2) return { kind: 'ignore' };
  const payload = bytes.subarray(1);

  if (bytes[0] === FRAME_UPDATE) return { kind: 'update', payload };
  if (bytes[0] === FRAME_PRESENCE) return { kind: 'presence', payload };
  if (bytes[0] === FRAME_CONTROL) {
    let msg: { t?: string } | null = null;
    try { msg = JSON.parse(new TextDecoder().decode(payload)) as { t?: string }; } catch { return { kind: 'ignore' }; }
    return msg?.t === 'save' ? { kind: 'save' } : { kind: 'ignore' };
  }
  return { kind: 'ignore' };
}
