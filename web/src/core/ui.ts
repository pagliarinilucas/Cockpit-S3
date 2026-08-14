// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
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
