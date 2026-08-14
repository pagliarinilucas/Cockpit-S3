// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
// Geração de miniaturas server-side: imagens via sharp, PDFs via pdftoppm (poppler-utils).
// Devolve null quando não dá pra gerar (formato não suportado / ferramenta ausente);
// o frontend cai no ícone genérico nesse caso.

const SIZE = 256;

// sharp é best-effort (binário nativo). Carrega lazy; se faltar, imagens não geram thumb.
type SharpFn = (input: Buffer) => any;
let sharpMod: SharpFn | null | undefined;
async function getSharp(): Promise<SharpFn | null> {
  if (sharpMod !== undefined) return sharpMod;
  try { sharpMod = (await import('sharp')).default as unknown as SharpFn; }
  catch { sharpMod = null; }
  return sharpMod;
}

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/** Rasteriza a 1ª página do PDF para PNG via pdftoppm lendo de stdin. */
async function pdfThumb(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const proc = Bun.spawn(['pdftoppm', '-png', '-f', '1', '-l', '1', '-scale-to', String(SIZE), '-'], {
      stdin: data, stdout: 'pipe', stderr: 'ignore',
    });
    const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    await proc.exited;
    return proc.exitCode === 0 && out.length > 0 ? out : null;
  } catch { return null; }   // pdftoppm não instalado
}

export interface Thumb { bytes: Uint8Array; mime: string; }

export async function makeThumb(data: Uint8Array): Promise<Thumb | null> {
  if (isPdf(data)) {
    const png = await pdfThumb(data);
    return png ? { bytes: png, mime: 'image/png' } : null;
  }
  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    const bytes = new Uint8Array(await sharp(Buffer.from(data))
      .rotate()                                                   // respeita orientação EXIF
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer());
    return { bytes, mime: 'image/jpeg' };
  } catch { return null; }   // não é imagem suportada
}
