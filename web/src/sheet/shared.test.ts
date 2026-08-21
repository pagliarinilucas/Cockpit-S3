// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * O contrato do código compartilhado: api/src/sheet/{model,styles,theme,
 * conditional,layout}.ts são importados pelo BROWSER via alias `@sheet`. Se
 * algum deles voltar a puxar um módulo de Node, o build do web quebra — e o
 * erro aparece longe da causa. Este teste falha na hora, apontando o arquivo.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conditionalStyle, contextFrom, todaySerial } from '@sheet/conditional';
import { parseLayout } from '@sheet/layout';
import { parseStyles } from '@sheet/styles';
import { parseTheme } from '@sheet/theme';
import { cellKey } from '@sheet/model';

const SHARED = ['model.ts', 'styles.ts', 'theme.ts', 'conditional.ts', 'layout.ts'];
const DIR = join(import.meta.dir, '../../../api/src/sheet');

describe('módulos compartilhados com o servidor', () => {
  for (const file of SHARED) {
    it(`${file} não importa nada de Node`, () => {
      const src = readFileSync(join(DIR, file), 'utf8');
      const offenders = [...src.matchAll(/from ['"](node:[^'"]+|fs|path|crypto)['"]/g)].map((m) => m[1]);
      expect(offenders).toEqual([]);
    });
  }

  it('cada um deles carrega e funciona pelo alias @sheet', () => {
    expect(cellKey(1, 2)).toBe('R1C2');
    expect(parseTheme(null)[7]).toBe('FFC000');
    expect(parseStyles('<styleSheet><cellXfs count="0"/></styleSheet>').dxfs).toEqual([]);
    expect(parseLayout('<worksheet><sheetData/></worksheet>').merges).toEqual([]);
    expect(typeof todaySerial()).toBe('number');
    expect(conditionalStyle([], [], 0, 0, 1, contextFrom(new Map(), 0))).toBeNull();
  });
});
