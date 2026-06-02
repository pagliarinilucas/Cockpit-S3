import type { FileType } from './models';

/** Client-side upload progress entry (not part of the API). */
export interface UploadItem {
  id: string;
  name: string;
  size: number;
  type: FileType;
  progress: number; // 0..1
  error?: boolean;
}
