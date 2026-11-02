// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect, beforeEach } from 'bun:test';
import { applyBranding, useBranding, DEFAULT_BRANDING } from './branding';

const ACME = {
  active: true, productName: 'ACME Drive', accentColor: '#ff0055', logo: null, sharePageMessage: '', hidePoweredBy: false,
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--neon');
});

test('branding ativo aplica título e cor de destaque da organização', () => {
  applyBranding(ACME);
  expect(document.title).toBe('ACME Drive');
  expect(document.documentElement.style.getPropertyValue('--neon')).toBe('#ff0055');
  const { productName, showPoweredBy } = useBranding();
  expect(productName.value).toBe('ACME Drive');
  expect(showPoweredBy.value).toBe(true);
});

test('tema escolhido pelo usuário prevalece sobre a cor da organização', () => {
  localStorage.setItem('cockpit.theme', 'cargo');
  applyBranding(ACME);
  expect(document.documentElement.style.getPropertyValue('--neon')).toBe('');
});

test('sem licença volta ao padrão e esconde o rodapé', () => {
  applyBranding(ACME);
  applyBranding({ ...DEFAULT_BRANDING, productName: 'ignorado' });
  expect(document.title).toBe('Cockpit S3');
  expect(document.documentElement.style.getPropertyValue('--neon')).toBe('');
  const { productName, showPoweredBy } = useBranding();
  expect(productName.value).toBe('Cockpit S3');
  expect(showPoweredBy.value).toBe(false);
});

test('white-label oculta o rodapé', () => {
  applyBranding({ ...ACME, hidePoweredBy: true });
  expect(useBranding().showPoweredBy.value).toBe(false);
});
