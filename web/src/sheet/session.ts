// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Conexão do editor: Y.Doc local espelhando o do servidor por WebSocket.
 * Edição é aplicada local na hora (otimista) e o update sai no mesmo tick; se a
 * conexão cair, as edições continuam no doc local e o Yjs reconcilia no
 * reconnect — nada digitado se perde por causa de rede.
 */
import * as Y from 'yjs';
import { api, ApiError } from '../core/api';
import type { SheetLayout } from '@sheet/layout';
import type { CfRule } from '@sheet/conditional';
import {
  SHEET_ORDER, SHEET_PREFIX, STYLES, cellKey, isBlankStyle, mergeStyle, styleKey,
  type Cell, type CellStyle, type CellValue,
} from './model';

export const FRAME_UPDATE = 1;
export const FRAME_PRESENCE = 2;
export const FRAME_CONTROL = 3;

export type Status = 'conectando' | 'ligado' | 'reconectando' | 'fechado';

export interface Peer { id: number; user: string }

/** Geometria + regras condicionais de uma aba (espelha SheetRender do servidor). */
export interface SheetRender {
  layout: SheetLayout;
  cf: CfRule[];
}

export interface Presence {
  user: string;
  sheet: string;
  row: number;
  col: number;
}

export interface SheetHandlers {
  onStatus: (s: Status) => void;
  onReady: (a: {
    sheets: string[];
    diverged: boolean;
    peers: Peer[];
    /** Geometria e regras condicionais por aba, vindas do arquivo. */
    layout: Record<string, SheetRender>;
    dxfs: CellStyle[];
  }) => void;
  onPeers: (peers: Peer[]) => void;
  onPresence: (clientId: number, p: Presence) => void;
  onSaved: (changed: number) => void;
  onUnchanged: () => void;
  onDiverged: () => void;
  onError: (message: string) => void;
  onChange: () => void;
}

const RETRY_MS = [500, 1000, 2000, 5000, 10_000];
const PERMANENT = new Set([403, 415, 503]);

/**
 * Em produção o SPA e a API são a mesma origem, então o WS usa `location.host`.
 * Em dev o vite serve o SPA numa porta e a API roda noutra, e o proxy de
 * WebSocket do vite não repassa o upgrade (testado: até um servidor WS trivial
 * dá timeout através dele) — por isso o dev fala direto com a API. Ajuste a
 * porta com VITE_API_WS se sua API não estiver na 3000.
 */
function wsOrigin(): string {
  const override = import.meta.env.VITE_API_WS as string | undefined;
  if (override) return override.replace(/\/$/, '');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) return `${proto}//${location.hostname}:3000`;
  return `${proto}//${location.host}`;
}

export class SheetSession {
  readonly doc = new Y.Doc();
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUs = false;
  private pending: Uint8Array[] = [];

  constructor(
    private readonly bucketId: string,
    private readonly key: string,
    private readonly handlers: SheetHandlers,
  ) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'local') { this.handlers.onChange(); return; }
      this.sendFrame(FRAME_UPDATE, update);
      this.handlers.onChange();
    });
  }

  sheetMap(name: string) { return this.doc.getMap<Cell>(SHEET_PREFIX + name); }
  sheetNames(): string[] { return this.doc.getArray<string>(SHEET_ORDER).toArray(); }

  /**
   * Escreve uma célula preservando a formatação dela. O `w` é descartado: o
   * texto formatado do Excel era do valor antigo.
   */
  setCell(sheet: string, row: number, col: number, value: CellValue): void {
    const map = this.sheetMap(sheet);
    const k = cellKey(row, col);
    this.doc.transact(() => {
      const style = map.get(k)?.s;
      if ((value === null || value === '') && style === undefined) map.delete(k);
      else map.set(k, style === undefined ? { v: value } : { v: value, s: style });
    }, 'local');
  }

  stylesMap() { return this.doc.getMap<CellStyle>(STYLES); }

  styleOf(cell: Cell | undefined): CellStyle | undefined {
    return cell?.s === undefined ? undefined : this.stylesMap().get(cell.s);
  }

  styleAt(sheet: string, row: number, col: number): CellStyle {
    return this.styleOf(this.sheetMap(sheet).get(cellKey(row, col))) ?? {};
  }

  /**
   * Id do estilo com esse visual, criando se não existir. Mesma regra do
   * servidor: visual novo é gravado sem `xf`, senão o arquivo seria remontado
   * com o estilo antigo e a mudança sumiria.
   */
  private ensureStyle(style: CellStyle): string {
    const styles = this.stylesMap();
    const wanted = styleKey(style);
    for (const [id, existing] of styles.entries()) {
      if (existing && styleKey(existing) === wanted) return id;
    }
    const { xf: _drop, ...visual } = style;
    let n = styles.size;
    let id = `n${n}`;
    while (styles.has(id)) id = `n${++n}`;
    styles.set(id, visual);
    return id;
  }

  /**
   * Aplica uma alteração de formatação em cada célula da faixa, mesclando com o
   * que a célula já tinha (pintar não apaga o negrito que já estava lá).
   */
  applyStyle(
    sheet: string,
    ranges: { top: number; left: number; bottom: number; right: number }[],
    change: Partial<CellStyle>,
  ): void {
    const map = this.sheetMap(sheet);
    const seen = new Set<string>();
    // Uma transação para todas as faixas: vira um update e um undo, mesmo com
    // seleção solta. Células repetidas entre faixas são aplicadas uma vez.
    this.doc.transact(() => {
      for (const range of ranges) {
        for (let row = range.top; row <= range.bottom; row++) {
          for (let col = range.left; col <= range.right; col++) {
            if (seen.has(`${row}:${col}`)) continue;
            seen.add(`${row}:${col}`);
            const k = cellKey(row, col);
            const prev = map.get(k);
            const next = mergeStyle(this.styleOf(prev) ?? {}, change);
            const value = prev?.v ?? null;

            if (isBlankStyle(next)) {
              if (value === null) map.delete(k);
              else map.set(k, { v: value });
              continue;
            }
            // O texto formatado do Excel é descartado: quem passa a renderizar
            // é o formatador local, com o código de formato novo.
            map.set(k, { v: value, s: this.ensureStyle(next) });
          }
        }
      }
    }, 'local');
  }

  /** Colar em bloco: uma transação só, então vai num update e num undo. */
  setBlock(sheet: string, top: number, left: number, rows: CellValue[][]): void {
    const map = this.sheetMap(sheet);
    this.doc.transact(() => {
      rows.forEach((cols, r) => cols.forEach((value, c) => {
        const k = cellKey(top + r, left + c);
        const style = map.get(k)?.s;
        if ((value === null || value === '') && style === undefined) map.delete(k);
        else map.set(k, style === undefined ? { v: value } : { v: value, s: style });
      }));
    }, 'local');
  }

  async connect(): Promise<void> {
    this.closedByUs = false;
    this.handlers.onStatus(this.attempt ? 'reconectando' : 'conectando');
    let ticket: string;
    try {
      ({ ticket } = await api.sheetTicket(this.bucketId, this.key));
    } catch (e) {
      // Permissão negada, tipo não suportado ou criptografia indisponível não
      // melhoram com o tempo — reconectar em loop só geraria toast infinito.
      const status = e instanceof ApiError ? e.status : 0;
      if (PERMANENT.has(status)) {
        this.closedByUs = true;
        this.handlers.onError(status === 403 ? 'sem_permissao' : status === 503 ? 'sealed' : 'nao_e_planilha');
        this.handlers.onStatus('fechado');
        return;
      }
      this.handlers.onError(String((e as Error).message ?? e));
      this.retry();
      return;
    }

    const ws = new WebSocket(`${wsOrigin()}/api/sheets?ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus('ligado');
      // Manda o estado local primeiro: se digitamos offline, o servidor recebe agora.
      this.sendFrame(FRAME_UPDATE, Y.encodeStateAsUpdate(this.doc));
      for (const frame of this.pending.splice(0)) ws.send(frame);
    };

    ws.onmessage = (ev) => {
      // Frame de texto significa que alguém serializou o binário no caminho
      // (o wrapper de ws do Elysia faz isso com Uint8Array). Falha visível em
      // vez de tela de "carregando" infinita.
      if (!(ev.data instanceof ArrayBuffer)) { this.handlers.onError('protocolo_binario'); return; }
      this.onFrame(new Uint8Array(ev.data));
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) { this.handlers.onStatus('fechado'); return; }
      this.retry();
    };

    ws.onerror = () => { /* onclose cuida do retry */ };
  }

  private retry(): void {
    if (this.closedByUs) return;
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!;
    this.attempt++;
    this.handlers.onStatus('reconectando');
    setTimeout(() => { if (!this.closedByUs) void this.connect(); }, wait);
  }

  private onFrame(bytes: Uint8Array): void {
    if (!bytes.byteLength) return;
    const payload = bytes.subarray(1);
    if (bytes[0] === FRAME_UPDATE) { Y.applyUpdate(this.doc, payload, 'remote'); return; }
    if (bytes[0] === FRAME_PRESENCE) {
      const p = parse<{ clientId: number } & Presence>(payload);
      if (p) this.handlers.onPresence(p.clientId, p);
      return;
    }
    if (bytes[0] !== FRAME_CONTROL) return;

    const msg = parse<Record<string, unknown>>(payload);
    if (!msg) return;
    if (msg.t === 'ready') {
      this.handlers.onReady({
        sheets: (msg.sheets as string[]) ?? [],
        diverged: !!msg.diverged,
        peers: (msg.peers as Peer[]) ?? [],
        layout: (msg.layout as Record<string, SheetRender>) ?? {},
        dxfs: (msg.dxfs as CellStyle[]) ?? [],
      });
    } else if (msg.t === 'peers') this.handlers.onPeers((msg.peers as Peer[]) ?? []);
    else if (msg.t === 'saved') this.handlers.onSaved(Number(msg.changed ?? 0));
    else if (msg.t === 'unchanged') this.handlers.onUnchanged();
    else if (msg.t === 'diverged') this.handlers.onDiverged();
    else if (msg.t === 'error') this.handlers.onError(String(msg.message ?? 'erro'));
  }

  private sendFrame(type: number, payload: Uint8Array): void {
    const out = new Uint8Array(payload.byteLength + 1);
    out[0] = type;
    out.set(payload, 1);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(out);
    else if (type !== FRAME_UPDATE) this.pending.push(out);
    // Update fora do ar não é enfileirado: o doc local já guarda a edição e o
    // estado inteiro é reenviado no onopen.
  }

  sendPresence(p: Presence): void {
    this.sendFrame(FRAME_PRESENCE, new TextEncoder().encode(JSON.stringify(p)));
  }

  requestSave(): void {
    this.sendFrame(FRAME_CONTROL, new TextEncoder().encode(JSON.stringify({ t: 'save' })));
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
    this.doc.destroy();
  }
}

function parse<T>(payload: Uint8Array): T | null {
  try { return JSON.parse(new TextDecoder().decode(payload)) as T; } catch { return null; }
}
