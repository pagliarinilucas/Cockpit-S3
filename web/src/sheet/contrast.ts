// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Cor de texto legível sobre o preenchimento da célula.
 *
 * O problema real: a planilha guarda o preenchimento, mas quase nunca a cor da
 * fonte (fica "automática", que no Excel significa "preto sobre claro"). No
 * tema escuro o texto padrão é claro, então uma célula com preenchimento claro
 * do arquivo — amarelo, laranja, azul-claro — ficava texto claro em fundo
 * claro, ilegível. Quando o arquivo NÃO diz a cor da fonte, ela é derivada do
 * preenchimento; quando diz, a escolha do autor é respeitada.
 */

const DARK_INK = '#1f2933';
const LIGHT_INK = '#f5f7fa';

/** Luminância relativa (WCAG), 0 = preto, 1 = branco. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Tinta legível sobre esse fundo: a das duas que dá MAIS contraste. Um limiar
 * fixo de luminância erra nos tons médios — vermelho claro (FF7575) cai do lado
 * "escuro" e receberia tinta clara, com contraste de 2,4.
 */
export function inkFor(bg: string): string {
  const dark = contrastRatio(bg, DARK_INK.slice(1));
  const light = contrastRatio(bg, LIGHT_INK.slice(1));
  return dark >= light ? DARK_INK : LIGHT_INK;
}

/**
 * Contraste entre duas cores (WCAG): 1 = idêntico, 21 = preto sobre branco.
 * 4.5 é o mínimo recomendado para texto normal.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
