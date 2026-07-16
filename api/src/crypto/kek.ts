// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * KekProvider: abstrai a origem da KEK (Fase 1: arquivo/env). A KEK fica só em
 * RAM; nunca é gravada no SQLite (org_keys guarda versão, modo e um verificador).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { orgKeys } from '../db/schema';
import { readKekBytes } from '../config';
import { generateKek, makeVerifier, checkVerifier, wrapDek, unwrapDek } from './index';
import { DEFAULT_ORG } from './constants';

export interface KekStatus {
  mode: string;
  sealed: boolean;
  currentVersion: number | null;
}

export interface KekProvider {
  getKek(orgId: string, version: number): Buffer;
  getCurrentVersion(orgId: string): number;
  status(): KekStatus;
  wrapWithCurrent(orgId: string, dek: Buffer): { wrapped: Buffer; version: number };
  unwrapDek(orgId: string, version: number, wrapped: Buffer): Buffer;
}

class FileKekProvider implements KekProvider {
  // versão -> KEK em RAM (Fase 1 tem só a v corrente; Fase 3 adiciona mais)
  private keys = new Map<number, Buffer>();
  private current = 1;

  constructor(kek: Buffer) {
    const existing = db.select({ version: orgKeys.version, verifier: orgKeys.verifier })
      .from(orgKeys).where(eq(orgKeys.orgId, DEFAULT_ORG)).all();
    if (existing.length === 0) {
      // primeira init: registra v1 + verificador
      db.insert(orgKeys).values({
        orgId: DEFAULT_ORG, version: 1, kekState: 'plaintext_env',
        verifier: makeVerifier(kek), createdAt: new Date().toISOString(),
      }).run();
      this.current = 1;
    } else {
      this.current = existing.reduce((m, r) => Math.max(m, r.version), 1);
      const cur = existing.find((r) => r.version === this.current)!;
      if (!checkVerifier(cur.verifier as Buffer, kek)) {
        throw new Error(`KEK não confere com a versão ${this.current} registrada em org_keys`);
      }
    }
    this.keys.set(this.current, kek);
  }

  getKek(_orgId: string, version: number): Buffer {
    const k = this.keys.get(version);
    if (!k) throw new Error(`KEK versão ${version} indisponível`);
    return k;
  }
  getCurrentVersion(_orgId: string): number { return this.current; }
  status(): KekStatus { return { mode: 'plaintext_env', sealed: false, currentVersion: this.current }; }
  wrapWithCurrent(orgId: string, dek: Buffer) {
    return { wrapped: wrapDek(dek, this.getKek(orgId, this.current)), version: this.current };
  }
  unwrapDek(orgId: string, version: number, wrapped: Buffer): Buffer {
    return unwrapDek(wrapped, this.getKek(orgId, version));
  }
}

let provider: KekProvider | null = null;

/** Inicializa o provider a partir da KEK (arquivo/env). Idempotente-ish: recria o objeto. */
export function initFileKekProvider(): KekProvider {
  const kek = readKekBytes();
  if (!kek) throw new Error('KEK não configurada (COCKPIT_KEK_FILE ou COCKPIT_KEK)');
  provider = new FileKekProvider(kek);
  return provider;
}

/** Provider corrente, ou null se a KEK não estiver configurada. */
export function getKekProvider(): KekProvider | null { return provider; }

/** Chamado no boot: liga o provider se houver KEK; silencioso se não houver. */
export function bootKekProvider(): void {
  try {
    if (readKekBytes()) initFileKekProvider();
  } catch (e) {
    // KEK inválida/trocada: aborta o boot (fail-fast). Não loga a KEK.
    console.error('[crypto] falha ao inicializar KEK:', (e as Error).message);
    process.exit(1);
  }
}
