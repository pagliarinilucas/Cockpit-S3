// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { FileType, Bucket } from './models';
import { t } from '../i18n';

const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;

export function fmtBytes(b?: number): string {
  if (b == null) return '—';
  if (b >= GB) return (b / GB).toFixed(b / GB >= 100 ? 0 : 1) + ' GB';
  if (b >= MB) return (b / MB).toFixed(b / MB >= 100 ? 0 : 1) + ' MB';
  if (b >= KB) return (b / KB).toFixed(0) + ' KB';
  return b + ' B';
}

/** Compact "time ago": "now", "3 min", "2 h", "5 d". */
export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.floor((Date.now() - time) / 1000);
  if (seconds < 60) return t('time.now');
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60); if (hours < 24) return t('time.hours', { count: hours });
  const days = Math.floor(hours / 24); if (days < 30) return t('time.days', { count: days });
  return t('time.months', { count: Math.floor(days / 30) });
}

export function timeAgoPhrase(iso?: string): string {
  const compact = timeAgo(iso);
  if (!compact) return '';
  return compact === t('time.now') ? t('time.justNow') : t('time.ago', { time: compact });
}

const EXT_TYPE: Record<string, FileType> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio',
  pdf: 'pdf',
  csv: 'sheet', xlsx: 'sheet', xls: 'sheet',
  js: 'code', ts: 'code', json: 'code', xml: 'code', html: 'code', css: 'code', yml: 'code', yaml: 'code',
  txt: 'text', md: 'text', log: 'text',
  zip: 'archive', gz: 'archive', tar: 'archive', rar: 'archive', apk: 'archive', rdb: 'archive', dump: 'archive', '7z': 'archive',
};

export function typeFromName(name: string): FileType {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_TYPE[ext] || 'file';
}

// 'file' (unknown/extension-less) is previewable too — Preview sniffs the bytes
// and shows image/pdf, or a name-only screen when it can't render it.
const PREVIEWABLE = new Set<FileType>(['image', 'video', 'audio', 'pdf', 'text', 'code', 'sheet', 'file']);
export function isPreviewable(type: FileType): boolean {
  return PREVIEWABLE.has(type);
}

/** Rótulo exibido de um bucket: apelido, senão nome, senão id. */
export function bucketLabel(b: Bucket): string {
  return b.alias?.trim() || b.name || b.id;
}

/** Pode excluir? Só owner, bucket comprovadamente vazio (stats já carregadas). */
export function canDeleteBucket(b: Bucket): boolean {
  return b.perm === 'owner' && !b.statsLoading && b.objects === 0;
}

export const ICON_FOR: Record<FileType, string> = {
  image: 'image', video: 'video', audio: 'audio', pdf: 'pdf',
  sheet: 'sheet', code: 'code', text: 'text', archive: 'archive', file: 'file',
};
