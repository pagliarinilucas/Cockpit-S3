// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { PDFDocument } from 'pdf-lib';

// sharp é best-effort: rasteriza formatos não-nativos (webp/gif/avif/svg/tiff) para PNG.
// Se o binário nativo não carregar, seguimos só com JPG/PNG/PDF e reportamos os pulados.
type SharpFn = (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
let sharpMod: SharpFn | null | undefined;
async function getSharp(): Promise<SharpFn | null> {
  if (sharpMod !== undefined) return sharpMod;
  try { sharpMod = (await import('sharp')).default as unknown as SharpFn; }
  catch { sharpMod = null; }
  return sharpMod;
}

/** Detecta o tipo por magic bytes (Garage costuma gravar application/octet-stream). */
function sniff(b: Uint8Array): 'pdf' | 'png' | 'jpg' | 'other' {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';   // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';   // \x89PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';                     // FFD8FF
  return 'other';
}

const A4 = { w: 595.28, h: 841.89 };   // pt

/** Página dimensionada à imagem (72dpi), limitada ao envelope A4, mantendo o aspecto. */
function addImagePage(doc: PDFDocument, img: { width: number; height: number }, draw: (page: ReturnType<PDFDocument['addPage']>, w: number, h: number) => void) {
  let w = img.width, h = img.height;
  const max = w > h ? { w: A4.h, h: A4.w } : A4;   // paisagem gira a página
  const scale = Math.min(1, max.w / w, max.h / h);
  w = Math.max(1, w * scale); h = Math.max(1, h * scale);
  const page = doc.addPage([w, h]);
  draw(page, w, h);
}

export interface MergeResult { pdf: Uint8Array | null; skipped: { key: string; reason: string }[]; }

/**
 * Junta as `keys` (NA ORDEM recebida) num único PDF. `fetchBytes` busca cada objeto
 * sob demanda — pico de memória ≈ 1 origem + PDF de saída. Itens não-mescláveis,
 * corrompidos ou protegidos caem em `skipped`; o merge continua com os demais.
 */
export async function mergeToPdf(keys: string[], fetchBytes: (key: string) => Promise<Uint8Array>): Promise<MergeResult> {
  const doc = await PDFDocument.create();
  const skipped: { key: string; reason: string }[] = [];
  let added = 0;

  for (const key of keys) {
    try {
      const data = await fetchBytes(key);
      const kind = sniff(data);

      if (kind === 'pdf') {
        const src = await PDFDocument.load(data);                 // PDF com senha lança aqui -> skipped
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const p of pages) doc.addPage(p);
        added++;
        continue;
      }

      let bytes = data, fmt: 'png' | 'jpg' = 'png';
      if (kind === 'png') { fmt = 'png'; }
      else if (kind === 'jpg') { fmt = 'jpg'; }
      else {
        const sharp = await getSharp();
        if (!sharp) { skipped.push({ key, reason: 'formato_nao_suportado' }); continue; }
        bytes = new Uint8Array(await sharp(Buffer.from(data)).png().toBuffer());
        fmt = 'png';
      }

      const img = fmt === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      addImagePage(doc, img, (page, w, h) => page.drawImage(img, { x: 0, y: 0, width: w, height: h }));
      added++;
    } catch (e) {
      skipped.push({ key, reason: String((e as Error)?.message || e).slice(0, 120) });
    }
  }

  if (added === 0) return { pdf: null, skipped };
  return { pdf: await doc.save(), skipped };
}
