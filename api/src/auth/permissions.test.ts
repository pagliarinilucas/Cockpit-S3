import { describe, it, expect } from 'bun:test';
import { resolvePerm, folderVisible, maxBucketPerm, type Allow } from './permissions';

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
});
