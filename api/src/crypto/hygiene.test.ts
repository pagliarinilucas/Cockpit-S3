// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('higiene de segredos', () => {
  it('nenhum console.* loga variável kek/dek/passphrase/derived', () => {
    const offenders: string[] = [];
    // Tira literais de string PRIMEIRO (logar a PALAVRA "KEK" numa mensagem é ok;
    // logar a VARIÁVEL que segura o material não é). Depois procura o identificador
    // como argumento nu de um console.*.
    const stripStrings = (s: string) =>
      s.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '``');
    const re = /console\.\w+\([^)]*\b(kek|dek|passphrase|wrapped|verifier)\b/;
    for (const f of walk(join(import.meta.dir, '..'))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (re.test(stripStrings(line))) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
