// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { license } from '../license/service';

export interface BrandingSettings {
  productName: string;
  accentColor: string | null;
  logo: string | null;
  sharePageMessage: string;
  hidePoweredBy: boolean;
}

export interface PublicBranding extends BrandingSettings {
  active: boolean;
}

export interface BrandingPatch {
  productName?: string;
  accentColor?: string | null;
  logo?: string | null;
  sharePageMessage?: string;
  hidePoweredBy?: boolean;
}

export const DEFAULT_PRODUCT_NAME = 'Cockpit S3';
export const MAX_PRODUCT_NAME_LENGTH = 60;
export const MAX_SHARE_MESSAGE_LENGTH = 280;
export const MAX_LOGO_BYTES = 256 * 1024;
const SETTINGS_KEY = 'branding';

export const DEFAULT_BRANDING: BrandingSettings = {
  productName: DEFAULT_PRODUCT_NAME,
  accentColor: null,
  logo: null,
  sharePageMessage: '',
  hidePoweredBy: false,
};

type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

const LOGO_SIGNATURES: Record<LogoMime, (bytes: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

export class BrandingError extends Error {
  constructor(public code: string) { super(code); }
}

export function validateLogo(dataUrl: string): string {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl.trim());
  if (!match) throw new BrandingError('logo_invalid');
  const mime = match[1]!.toLowerCase();
  if (!(mime in LOGO_SIGNATURES)) throw new BrandingError('logo_type');
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length > MAX_LOGO_BYTES) throw new BrandingError('logo_too_large');
  if (!LOGO_SIGNATURES[mime as LogoMime](bytes)) throw new BrandingError('logo_invalid');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function normalizeAccentColor(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BrandingError('invalid_color');
  return color;
}

function sanitizeText(value: string, maxLength: number, code: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > maxLength) throw new BrandingError(code);
  return text;
}

function readStored(): BrandingSettings {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (!row) return { ...DEFAULT_BRANDING };
  try {
    return { ...DEFAULT_BRANDING, ...(JSON.parse(row.value) as Partial<BrandingSettings>) };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

function write(next: BrandingSettings): void {
  const value = JSON.stringify(next);
  db.insert(settings).values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export const brandingStore = {
  get(): BrandingSettings {
    return readStored();
  },
  effective(): PublicBranding {
    if (!license.has('branding')) return { ...DEFAULT_BRANDING, active: false };
    const stored = readStored();
    return { ...stored, hidePoweredBy: stored.hidePoweredBy && license.has('white-label'), active: true };
  },
  update(patch: BrandingPatch): BrandingSettings {
    const current = readStored();
    const next: BrandingSettings = { ...current };
    if (patch.productName !== undefined) {
      next.productName = sanitizeText(patch.productName, MAX_PRODUCT_NAME_LENGTH, 'invalid_product_name') || DEFAULT_PRODUCT_NAME;
    }
    if (patch.accentColor !== undefined) next.accentColor = normalizeAccentColor(patch.accentColor);
    if (patch.logo !== undefined) next.logo = patch.logo === null ? null : validateLogo(patch.logo);
    if (patch.sharePageMessage !== undefined) {
      next.sharePageMessage = sanitizeText(patch.sharePageMessage, MAX_SHARE_MESSAGE_LENGTH, 'invalid_share_message');
    }
    if (patch.hidePoweredBy !== undefined && license.has('white-label')) next.hidePoweredBy = patch.hidePoweredBy;
    write(next);
    return next;
  },
  removeLogo(): BrandingSettings {
    const next = { ...readStored(), logo: null };
    write(next);
    return next;
  },
};
