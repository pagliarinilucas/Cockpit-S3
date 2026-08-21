// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Cores de tema do xlsx. Boa parte das planilhas do Excel não guarda a cor em
 * RGB: guarda `theme="7" tint="0.8"`, que é "o 8º slot da paleta do tema,
 * clareado em 80%". Sem resolver isso, quase todo preenchimento do arquivo
 * aparece incolor — daí este módulo existir.
 */

/** Paleta padrão do tema Office, usada quando o arquivo não traz theme1.xml. */
const OFFICE = [
  'FFFFFF', '000000', 'E7E6E6', '44546A',
  '5B9BD5', 'ED7D31', 'A5A5A5', 'FFC000', '4472C4', '70AD47',
  '0563C1', '954F72',
];

/**
 * Ordem dos slots como o Excel os indexa em `theme="N"`. No XML o clrScheme vem
 * dk1, lt1, dk2, lt2, …, mas os índices 0..3 do Excel são lt1, dk1, lt2, dk2 —
 * os dois primeiros pares são invertidos.
 */
const SLOT_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3',
  'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;

export type ThemePalette = string[];

/** Cor de um slot do clrScheme: srgbClr val="…" ou sysClr lastClr="…". */
function slotColor(scheme: string, slot: string): string | null {
  const block = new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`).exec(scheme);
  if (!block) return null;
  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block[1]!)?.[1];
  if (srgb) return srgb.toUpperCase();
  const sys = /<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block[1]!)?.[1];
  return sys ? sys.toUpperCase() : null;
}

/** Paleta indexada por `theme="N"`. Sem theme1.xml, devolve a paleta Office. */
export function parseTheme(themeXml: string | null): ThemePalette {
  if (!themeXml) return [...OFFICE];
  const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(themeXml)?.[0];
  if (!scheme) return [...OFFICE];
  return SLOT_ORDER.map((slot, i) => slotColor(scheme, slot) ?? OFFICE[i]!);
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Aplica o `tint` do OOXML: positivo clareia na direção do branco, negativo
 * escurece na direção do preto (ECMA-376, §18.3.1.15).
 */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex.toUpperCase();
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const shifted = channels.map((c) => (tint > 0
    ? clamp255(c * (1 - tint) + 255 * tint)
    : clamp255(c * (1 + tint))));
  return shifted.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Cor final de um `theme="N" tint="T"`. Índice fora da paleta devolve null. */
export function themeColor(palette: ThemePalette, index: number, tint = 0): string | null {
  const base = palette[index];
  return base ? applyTint(base, tint) : null;
}
