// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { audit, type ActivityEvent, type ActivityFilter } from './store';

export type ExportFormat = 'csv' | 'json' | 'ndjson';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'ndjson'];

const CSV_COLUMNS = ['id', 'at', 'action', 'actor', 'bucket', 'target'] as const;
const CSV_LINE_END = '\r\n';
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  ndjson: 'application/x-ndjson; charset=utf-8',
};

export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && text.length && FORMULA_TRIGGERS.has(text[0]!)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(event: ActivityEvent): string {
  return CSV_COLUMNS.map((column) => csvCell(event[column])).join(',') + CSV_LINE_END;
}

function dayPart(iso: string | undefined, fallback: string): string {
  return iso ? iso.slice(0, 10) : fallback;
}

export function exportFilename(format: ExportFormat, filter: ActivityFilter, now = new Date()): string {
  const from = dayPart(filter.since, 'inicio');
  const to = dayPart(filter.until, now.toISOString().slice(0, 10));
  return `cockpit-audit-${from}-${to}.${format}`;
}

function serializeBatch(format: ExportFormat, batch: ActivityEvent[], isFirstBatch: boolean): string {
  if (format === 'csv') return batch.map(csvRow).join('');
  if (format === 'ndjson') return batch.map((e) => JSON.stringify(e) + '\n').join('');
  const body = batch.map((e) => JSON.stringify(e)).join(',\n');
  return isFirstBatch ? `\n${body}` : `,\n${body}`;
}

function opening(format: ExportFormat): string {
  if (format === 'csv') return CSV_COLUMNS.join(',') + CSV_LINE_END;
  return format === 'json' ? '[' : '';
}

function closing(format: ExportFormat, wroteAny: boolean): string {
  if (format !== 'json') return '';
  return wroteAny ? '\n]\n' : ']\n';
}

export function exportStream(format: ExportFormat, filter: ActivityFilter): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const batches = audit.iterate(filter);
  let started = false;
  let wroteAny = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk = '';
      if (!started) {
        started = true;
        chunk += opening(format);
      }
      const next = batches.next();
      if (next.done) {
        chunk += closing(format, wroteAny);
        if (chunk) controller.enqueue(encoder.encode(chunk));
        controller.close();
        return;
      }
      chunk += serializeBatch(format, next.value, !wroteAny);
      wroteAny = true;
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      batches.return(undefined);
    },
  });
}

export function exportResponse(format: ExportFormat, filter: ActivityFilter): Response {
  return new Response(exportStream(format, filter), {
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${exportFilename(format, filter)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
