// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { canDownloadPerm, canWritePerm, effectivePerm } from './perm';
import type { ObjectItem } from './models';

const file = (key: string, perm?: ObjectItem['perm']): ObjectItem =>
  ({ kind: 'file', name: key.split('/').pop()!, key, perm });

describe('canDownloadPerm', () => {
  it('read-only e acima baixam; view-only e null não', () => {
    expect(canDownloadPerm('owner')).toBe(true);
    expect(canDownloadPerm('read-write')).toBe(true);
    expect(canDownloadPerm('read-only')).toBe(true);
    expect(canDownloadPerm('view-only')).toBe(false);
    expect(canDownloadPerm(null)).toBe(false);
  });
});

describe('canWritePerm', () => {
  it('só read-write e owner escrevem', () => {
    expect(canWritePerm('owner')).toBe(true);
    expect(canWritePerm('read-write')).toBe(true);
    expect(canWritePerm('read-only')).toBe(false);
    expect(canWritePerm(null)).toBe(false);
  });
});

describe('effectivePerm', () => {
  it('perm do item vence a perm da pasta atual', () => {
    expect(effectivePerm(file('fin/nota.pdf', 'read-only'), null)).toBe('read-only');
  });
  it('sem perm no item, cai na perm da pasta atual', () => {
    expect(effectivePerm(file('fin/nota.pdf'), 'read-write')).toBe('read-write');
  });
  it('busca na raiz do bucket: resultado dentro de pasta concedida pode baixar', () => {
    const hit = file('fin/cte-12345.pdf', 'read-only');
    expect(canDownloadPerm(effectivePerm(hit, null))).toBe(true);
  });
  it('busca na raiz: resultado view-only continua sem download', () => {
    const hit = file('hr/folha.pdf', 'view-only');
    expect(canDownloadPerm(effectivePerm(hit, null))).toBe(false);
  });
});
