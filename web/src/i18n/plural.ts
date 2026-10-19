// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
export interface Plural {
  zero?: string;
  one: string;
  other: string;
}

export const plural = (forms: Plural): Plural => forms;

export const isPlural = (value: unknown): value is Plural =>
  typeof value === 'object' && value !== null && typeof (value as Plural).other === 'string' && typeof (value as Plural).one === 'string';
