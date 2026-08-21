// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * O contrato do pacote: tudo aqui roda no NAVEGADOR também. Se algum módulo
 * voltar a puxar um módulo de Node, o build do web quebra — e o erro aparece
 * longe da causa. Este teste falha na hora, apontando o arquivo.
 *
 * A lista de arquivos é lida do diretório, não escrita à mão: módulo novo entra
 * no teste sozinho, que é o ponto de ter a regra num lugar só.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NODE_ONLY = /from ['"](node:[^'"]+|fs|path|crypto|os|child_process)['"]/g;

const modules = readdirSync(import.meta.dir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort();

describe('pureza dos módulos compartilhados', () => {
  it('o diretório tem módulos para verificar', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  for (const file of modules) {
    it(`${file} não importa nada de Node`, () => {
      const src = readFileSync(join(import.meta.dir, file), 'utf8');
      const offenders = [...src.matchAll(NODE_ONLY)].map((m) => m[1]);
      expect(offenders).toEqual([]);
    });
  }
});
