// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';
import type { DemoBucket } from './catalog';

export interface DemoFile {
  bucket: DemoBucket;
  key: string;
  data: Uint8Array;
  contentType: string;
}

type RasterEncoder = (pixels: Buffer, width: number, height: number) => Promise<Uint8Array>;

const encoder = new TextEncoder();
const text = (body: string) => encoder.encode(body);

async function loadPngEncoder(): Promise<RasterEncoder | null> {
  try {
    const sharp = (await import('sharp')).default;
    return async (pixels, width, height) =>
      new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer());
  } catch {
    return null;
  }
}

function paintBadge(width: number, height: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.28;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mix = (x + y) / (width + height);
      const insideCircle = (x - centerX) ** 2 + (y - centerY) ** 2 < radius ** 2;
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const blended = from[channel]! * (1 - mix) + to[channel]! * mix;
        pixels[offset + channel] = insideCircle ? 255 - Math.round(blended / 3) : Math.round(blended);
      }
    }
  }
  return pixels;
}

async function buildPdf(title: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor('Cockpit S3 demo');
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.11, 0.16, 0.27) });
  page.drawText('ACME CORPORATION', { x: 48, y: 805, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 48, y: 730, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
  let cursor = 690;
  for (const line of lines) {
    page.drawText(line, { x: 48, y: cursor, size: 11, font: regular, color: rgb(0.2, 0.2, 0.2) });
    cursor -= 18;
  }
  page.drawText('Fictitious document generated for the Cockpit S3 public demo.', {
    x: 48, y: 40, size: 8, font: regular, color: rgb(0.5, 0.5, 0.5),
  });
  return pdf.save();
}

function buildWorkbook(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildDemoFiles(): Promise<DemoFile[]> {
  const files: DemoFile[] = [
    {
      bucket: 'acme-contracts',
      key: 'README.txt',
      contentType: 'text/plain; charset=utf-8',
      data: text('ACME contracts repository (fictitious data).\nSigned agreements live under contracts/<year>/.\nlegal-hold/ is restricted: the "viewer" account cannot see it.\n'),
    },
    {
      bucket: 'acme-contracts',
      key: 'contracts/2026/master-services-agreement.pdf',
      contentType: 'application/pdf',
      data: await buildPdf('Master Services Agreement', [
        'Between ACME Corporation and Globex Industries.',
        'Effective date: January 15, 2026. Term: 24 months.',
        'Scope: managed object storage and data retention services.',
        'Fees: USD 12,400 per month, invoiced quarterly.',
        'Governing law: State of Delaware.',
      ]),
    },
    {
      bucket: 'acme-contracts',
      key: 'contracts/2026/nda-globex.pdf',
      contentType: 'application/pdf',
      data: await buildPdf('Mutual Non-Disclosure Agreement', [
        'Parties: ACME Corporation and Globex Industries.',
        'Confidential information must be protected for 5 years.',
        'Signed electronically on February 3, 2026.',
      ]),
    },
    {
      bucket: 'acme-contracts',
      key: 'contracts/vendors.csv',
      contentType: 'text/csv',
      data: text('vendor,contract,start,end,monthly_usd\nGlobex Industries,MSA-2026-001,2026-01-15,2028-01-14,12400\nInitech,SUP-2025-014,2025-06-01,2026-05-31,3150\nUmbrella Logistics,LOG-2026-003,2026-03-01,2027-02-28,8900\n'),
    },
    {
      bucket: 'acme-contracts',
      key: 'legal-hold/litigation-notes.txt',
      contentType: 'text/plain; charset=utf-8',
      data: text('Case 2026-CV-0412 (fictitious).\nPreserve every e-mail and contract revision related to Initech until further notice.\n'),
    },
    {
      bucket: 'marketing-assets',
      key: 'campaigns/q4-launch/brief.txt',
      contentType: 'text/plain; charset=utf-8',
      data: text('Q4 launch brief\n- Audience: operations teams running S3-compatible storage\n- Message: one cockpit for every bucket\n- Channels: blog, newsletter, conference booth\n'),
    },
    {
      bucket: 'marketing-assets',
      key: 'press/press-release.pdf',
      contentType: 'application/pdf',
      data: await buildPdf('Press Release: ACME launches Cloud Vault', [
        'ACME Corporation today announced Cloud Vault,',
        'a self-hosted archive built on S3-compatible storage.',
        'Availability: immediately, in three regions.',
      ]),
    },
    {
      bucket: 'marketing-assets',
      key: 'social/posts.csv',
      contentType: 'text/csv',
      data: text('date,channel,headline,clicks\n2026-09-02,linkedin,Meet Cloud Vault,412\n2026-09-09,newsletter,Storage without surprises,1290\n2026-09-16,blog,How we cut archive costs by 40%,877\n'),
    },
    {
      bucket: 'finance-reports',
      key: '2026/q3-revenue.xlsx',
      contentType: XLSX_TYPE,
      data: buildWorkbook({
        Revenue: [
          ['Month', 'Region', 'Revenue (USD)', 'Costs (USD)'],
          ['July', 'North America', 184200, 121000],
          ['July', 'Europe', 97300, 66100],
          ['August', 'North America', 191800, 124500],
          ['August', 'Europe', 101450, 67900],
          ['September', 'North America', 203600, 129800],
          ['September', 'Europe', 108900, 70200],
        ],
        Summary: [
          ['Metric', 'Value'],
          ['Total revenue', 887250],
          ['Total costs', 579500],
          ['Gross margin', 0.347],
        ],
      }),
    },
    {
      bucket: 'finance-reports',
      key: '2026/budget.csv',
      contentType: 'text/csv',
      data: text('department,q1,q2,q3,q4\nEngineering,420000,435000,450000,470000\nMarketing,120000,140000,165000,190000\nOperations,210000,212000,215000,218000\n'),
    },
    {
      bucket: 'finance-reports',
      key: 'drafts/q4-forecast.xlsx',
      contentType: XLSX_TYPE,
      data: buildWorkbook({
        Forecast: [
          ['Month', 'Low', 'Expected', 'High'],
          ['October', 300000, 318000, 335000],
          ['November', 305000, 326000, 349000],
          ['December', 320000, 344000, 371000],
        ],
      }),
    },
    {
      bucket: 'finance-reports',
      key: 'drafts/notes.txt',
      contentType: 'text/plain; charset=utf-8',
      data: text('Draft notes: the "editor" account can write here even though finance-reports is read-only for the Finance group.\n'),
    },
  ];

  const encodePng = await loadPngEncoder();
  if (encodePng) {
    files.push(
      {
        bucket: 'marketing-assets',
        key: 'brand/logo.png',
        contentType: 'image/png',
        data: await encodePng(paintBadge(256, 256, [24, 52, 112], [36, 180, 160]), 256, 256),
      },
      {
        bucket: 'marketing-assets',
        key: 'campaigns/q4-launch/banner.png',
        contentType: 'image/png',
        data: await encodePng(paintBadge(640, 240, [120, 40, 140], [240, 140, 60]), 640, 240),
      },
    );
  }
  return files;
}
