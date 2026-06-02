import type { FileType } from './models';

const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;

export function fmtBytes(b?: number): string {
  if (b == null) return '—';
  if (b >= GB) return (b / GB).toFixed(b / GB >= 100 ? 0 : 1) + ' GB';
  if (b >= MB) return (b / MB).toFixed(b / MB >= 100 ? 0 : 1) + ' MB';
  if (b >= KB) return (b / KB).toFixed(0) + ' KB';
  return b + ' B';
}

/** Compact pt-BR "time ago": "agora", "3 min", "2 h", "5 d". */
export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60); if (m < 60) return m + ' min';
  const h = Math.floor(m / 60); if (h < 24) return h + ' h';
  const d = Math.floor(h / 24); if (d < 30) return d + ' d';
  const mo = Math.floor(d / 30); return mo + ' mês' + (mo > 1 ? 'es' : '');
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

const PREVIEWABLE = new Set<FileType>(['image', 'video', 'audio', 'pdf', 'text', 'code']);
export function isPreviewable(type: FileType): boolean {
  return PREVIEWABLE.has(type);
}

export const ICON_FOR: Record<FileType, string> = {
  image: 'image', video: 'video', audio: 'audio', pdf: 'pdf',
  sheet: 'sheet', code: 'code', text: 'text', archive: 'archive', file: 'file',
};
