// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Ambiente compartilhado dos testes que precisam de banco + KEK.
 *
 * O bun às vezes compartilha o registro de módulos entre arquivos de teste e às
 * vezes não, e a mistura (banco de um arquivo + KEK de outro) faz o provedor
 * falhar com "KEK não confere com a versão registrada". Caminhos e bytes FIXOS
 * eliminam o problema nos dois mundos: com registro compartilhado é o mesmo par,
 * com registro isolado cada processo recria o mesmo par.
 *
 * Importe este módulo ANTES de qualquer coisa que puxe `../db`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'cockpit-s3-sheet-tests');
mkdirSync(DIR, { recursive: true });

const KEK_FILE = join(DIR, 'kek.bin');
writeFileSync(KEK_FILE, Buffer.alloc(32, 9));

process.env.COCKPIT_KEK_FILE = KEK_FILE;
process.env.DB_PATH = join(DIR, 'db.sqlite');

/**
 * Materializa o schema e garante um provedor de KEK coerente com o banco.
 *
 * Falha alto se o banco em uso não for o de teste: isso acontece quando algum
 * módulo com estado (qualquer coisa que puxe `../db`) é importado no topo de um
 * arquivo de teste, antes deste módulo ajustar o DB_PATH — e o efeito seria
 * rodar os testes contra o banco real do dev.
 */
export async function bootTestEnv(): Promise<void> {
  const { config } = await import('../config');

  // Guarda: banco fora do diretório temporário significa que algum módulo com
  // estado foi importado antes deste (e o alvo seria o banco real do dev).
  // Banco temporário de OUTRO arquivo de teste é aceitável — o registro de
  // módulos do bun é compartilhado às vezes, e todos são descartáveis.
  if (!config.dbPath.startsWith(tmpdir())) {
    throw new Error(
      `teste apontando para banco fora do tmp: ${config.dbPath}. Importe './test-env' ANTES `
      + 'de qualquer módulo que puxe ../db (store, session, io, routes).',
    );
  }

  await import('../db');
  const kek = await import('../crypto/kek');
  // Provedor já inicializado = par banco+KEK coerente montado por outro arquivo.
  if (!kek.getKekProvider()) kek.initFileKekProvider();
}
