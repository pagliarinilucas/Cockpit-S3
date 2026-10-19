// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import * as common from './messages/common';
import * as errors from './messages/errors';
import * as app from './messages/app';
import * as auth from './messages/auth';
import * as share from './messages/share';
import * as ui from './messages/ui';
import * as files from './messages/files';
import * as buckets from './messages/buckets';
import * as preview from './messages/preview';
import * as users from './messages/users';
import * as cluster from './messages/cluster';
import * as activity from './messages/activity';
import * as settings from './messages/settings';
import * as sheet from './messages/sheet';
import * as demo from './messages/demo';

const modules = [common, errors, app, auth, share, ui, files, buckets, preview, users, cluster, activity, settings, sheet, demo] as const;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
export type Catalog = UnionToIntersection<(typeof modules)[number]['en']>;

const merge = (pick: (module: (typeof modules)[number]) => object) =>
  Object.assign({}, ...modules.map(pick)) as Catalog;

export const catalogs = {
  en: merge((module) => module.en),
  pt: merge((module) => module.pt),
};
