// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { resolvePerm, folderVisible, maxBucketPerm, perms, type Allow, type Access } from './permissions';

const access = (allows: Allow[], denies: string[] = []): Access => ({ all: false, allows, denies });

describe('resolvePerm', () => {
  it('allow no bucket inteiro concede em qualquer chave', () => {
    const allows: Allow[] = [{ prefix: '', perm: 'read-write' }];
    expect(resolvePerm(allows, [], 'a/b/c.txt')).toBe('read-write');
  });
  it('allow de pasta só vale sob o prefixo', () => {
    const allows: Allow[] = [{ prefix: 'fin/', perm: 'read-write' }];
    expect(resolvePerm(allows, [], 'fin/x.txt')).toBe('read-write');
    expect(resolvePerm(allows, [], 'hr/x.txt')).toBe(null);
  });
  it('união: maior perm vence entre fontes', () => {
    const allows: Allow[] = [{ prefix: '', perm: 'read-only' }, { prefix: 'fin/', perm: 'read-write' }];
    expect(resolvePerm(allows, [], 'fin/x.txt')).toBe('read-write');
    expect(resolvePerm(allows, [], 'hr/x.txt')).toBe('read-only');
  });
  it('deny do usuário é absoluto e vence qualquer allow', () => {
    const allows: Allow[] = [{ prefix: '', perm: 'owner' }];
    expect(resolvePerm(allows, ['sec/'], 'sec/secret.txt')).toBe(null);
    expect(resolvePerm(allows, ['sec/'], 'pub/x.txt')).toBe('owner');
  });
  it('deny cobre a subárvore inteira; allow mais fundo não reabre', () => {
    const allows: Allow[] = [{ prefix: 'sec/open/', perm: 'read-write' }];
    expect(resolvePerm(allows, ['sec/'], 'sec/open/x.txt')).toBe(null);
  });
});

describe('folderVisible', () => {
  const deep: Allow[] = [{ prefix: 'a/b/c/', perm: 'read-write' }];
  it('pasta-ancestral de um grant é visível (para navegar)', () => {
    expect(folderVisible(deep, [], 'a/')).toBe(true);
    expect(folderVisible(deep, [], 'a/b/')).toBe(true);
  });
  it('pasta coberta por allow é visível', () => {
    expect(folderVisible([{ prefix: 'a/', perm: 'read-only' }], [], 'a/b/')).toBe(true);
  });
  it('pasta-irmã sem acesso é escondida', () => {
    expect(folderVisible(deep, [], 'x/')).toBe(false);
  });
  it('pasta sob deny é escondida', () => {
    expect(folderVisible([{ prefix: '', perm: 'owner' }], ['sec/'], 'sec/')).toBe(false);
  });
});

describe('maxBucketPerm', () => {
  it('retorna o maior perm entre allows', () => {
    expect(maxBucketPerm([{ prefix: 'a/', perm: 'read-only' }, { prefix: 'b/', perm: 'owner' }], [])).toBe('owner');
  });
  it('deny na raiz esconde tudo', () => {
    expect(maxBucketPerm([{ prefix: 'a/', perm: 'owner' }], [''])).toBe(null);
  });
  it('sem allows → null', () => {
    expect(maxBucketPerm([], [])).toBe(null);
  });
  it('allow exatamente sombreado por deny → null (não autoriza listagem)', () => {
    expect(maxBucketPerm([{ prefix: 'fin/reports/', perm: 'read-write' }], ['fin/reports/'])).toBe(null);
  });
  it('view-only é o maior allow → retorna view-only', () => {
    expect(maxBucketPerm([{ prefix: '', perm: 'view-only' }], [])).toBe('view-only');
  });
  it('view-only perde para read-only na união', () => {
    expect(maxBucketPerm([{ prefix: 'a/', perm: 'view-only' }, { prefix: 'b/', perm: 'read-only' }], [])).toBe('read-only');
  });
});

describe('view-only na hierarquia', () => {
  it('resolvePerm resolve view-only quando é o único allow', () => {
    expect(resolvePerm([{ prefix: '', perm: 'view-only' }], [], 'a/b.txt')).toBe('view-only');
  });
});

describe('perms.canRead / canWrite / canDownload', () => {
  it('view-only → canRead true, canWrite false, canDownload false', () => {
    const a = access([{ prefix: '', perm: 'view-only' }]);
    expect(perms.canRead(a, 'x.pdf')).toBe(true);
    expect(perms.canWrite(a, 'x.pdf')).toBe(false);
    expect(perms.canDownload(a, 'x.pdf')).toBe(false);
  });
  it('read-only → canDownload true, canWrite false', () => {
    const a = access([{ prefix: '', perm: 'read-only' }]);
    expect(perms.canDownload(a, 'x.pdf')).toBe(true);
    expect(perms.canWrite(a, 'x.pdf')).toBe(false);
  });
  it('read-write → canDownload true', () => {
    const a = access([{ prefix: '', perm: 'read-write' }]);
    expect(perms.canDownload(a, 'x.pdf')).toBe(true);
  });
  it('owner → canDownload true', () => {
    const a = access([{ prefix: '', perm: 'owner' }]);
    expect(perms.canDownload(a, 'x.pdf')).toBe(true);
  });
  it('admin (access.all) → canDownload true', () => {
    expect(perms.canDownload({ all: true, allows: [], denies: [] }, 'x.pdf')).toBe(true);
  });
  it('deny sobre uma key view-only continua ocultando (canRead false)', () => {
    const a = access([{ prefix: '', perm: 'view-only' }], ['sec/']);
    expect(perms.canRead(a, 'sec/s.txt')).toBe(false);
    expect(perms.canDownload(a, 'sec/s.txt')).toBe(false);
  });
});
