// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

type Verdict = 'allowed' | 'review' | 'flagged';

interface Manifest {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<string | { type?: string }>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Entry {
  name: string;
  version: string;
  license: string;
  verdict: Verdict;
  usedBy: Set<string>;
}

const repoRoot = resolve(import.meta.dir, '..');
const roots = ['api', 'web', 'packages/sheet'];
const firstPartyScope = '@cockpit/';

const allowed = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0',
  'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0',
]);
const weakCopyleft = new Set(['MPL-2.0', 'LGPL-3.0-or-later', 'LGPL-3.0', 'LGPL-2.1-or-later', 'LGPL-2.1']);

const notes: Record<string, string> = {
  xlsx: 'SheetJS Community Edition. Apache-2.0, but the npm registry copy (0.18.5) is outdated and no longer updated there; SheetJS publishes current releases on its own CDN (https://cdn.sheetjs.com). Later CDN releases also fix published advisories against 0.18.5 (CVE-2023-30533, CVE-2024-22363). Plan to switch the dependency to the CDN tarball.',
  pako: 'MIT AND Zlib. Zlib is a permissive license (absent from the allow-list only because it is rare); the only obligation is keeping the notice. Accepted.',
  sharp: 'Apache-2.0. Prebuilt binaries load libvips from the @img/sharp-libvips-* packages (LGPL-3.0-or-later).',
  '@img/sharp-libvips-': 'LGPL-3.0-or-later libvips shared library, dynamically linked by sharp and replaceable by the user. Redistribution (including in a commercial build) is fine as long as the LGPL notice and license text are kept and the library is not statically merged into proprietary code.',
};

function readManifest(dir: string): Manifest | null {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
}

function licenseOf(manifest: Manifest): string {
  const field = manifest.license;
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object' && field.type) return field.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length) {
    const ids = manifest.licenses.map((item) => (typeof item === 'string' ? item : item.type ?? 'UNKNOWN'));
    return ids.length === 1 ? ids[0]! : `(${ids.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

function rank(verdict: Verdict): number {
  return verdict === 'allowed' ? 0 : verdict === 'review' ? 1 : 2;
}

function classifyId(id: string): Verdict {
  const clean = id.replace(/[()]/g, '').trim();
  if (allowed.has(clean)) return 'allowed';
  if (weakCopyleft.has(clean)) return 'review';
  return 'flagged';
}

function classify(expression: string): Verdict {
  const normalized = expression.replace(/^\(|\)$/g, '');
  if (/\sOR\s/i.test(normalized)) {
    const options = normalized.split(/\s+OR\s+/i).map(classify);
    return options.reduce((best, item) => (rank(item) < rank(best) ? item : best), 'flagged' as Verdict);
  }
  if (/\sAND\s/i.test(normalized)) {
    const parts = normalized.split(/\s+AND\s+/i).map(classify);
    return parts.reduce((worst, item) => (rank(item) > rank(worst) ? item : worst), 'allowed' as Verdict);
  }
  return classifyId(normalized);
}

function resolvePackage(name: string, fromDir: string, stopAt: string): string | null {
  let current = fromDir;
  while (true) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (current === stopAt) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function noteFor(name: string): string | undefined {
  if (notes[name]) return notes[name];
  return Object.entries(notes).find(([prefix]) => prefix.endsWith('-') && name.startsWith(prefix))?.[1];
}

const entries = new Map<string, Entry>();
const missingRequired: string[] = [];

function walk(root: string) {
  const rootDir = join(repoRoot, root);
  const rootManifest = readManifest(rootDir);
  if (!rootManifest) return;
  const queue: Array<{ dir: string; manifest: Manifest; searchFrom: string }> = [
    { dir: rootDir, manifest: rootManifest, searchFrom: rootDir },
  ];
  const visited = new Set<string>();
  while (queue.length) {
    const { manifest, searchFrom } = queue.shift()!;
    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});
    for (const [name, isOptional] of [
      ...required.map((n) => [n, false] as const),
      ...optional.map((n) => [n, true] as const),
    ]) {
      const dir = resolvePackage(name, searchFrom, rootDir) ?? resolvePackage(name, rootDir, rootDir);
      if (!dir) {
        if (!isOptional) missingRequired.push(`${root}: ${name}`);
        continue;
      }
      if (visited.has(dir)) continue;
      visited.add(dir);
      const depManifest = readManifest(dir);
      if (!depManifest) continue;
      const depName = depManifest.name ?? name;
      const searchBase = dir.startsWith(rootDir) ? dir : join(rootDir, 'node_modules', name);
      queue.push({ dir, manifest: depManifest, searchFrom: searchBase });
      if (depName.startsWith(firstPartyScope)) continue;
      const version = depManifest.version ?? '?';
      const key = `${depName}@${version}`;
      const license = licenseOf(depManifest);
      const existing = entries.get(key);
      if (existing) existing.usedBy.add(root);
      else entries.set(key, { name: depName, version, license, verdict: classify(license), usedBy: new Set([root]) });
    }
  }
}

for (const root of roots) walk(root);

const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const flagged = sorted.filter((entry) => entry.verdict === 'flagged');
const review = sorted.filter((entry) => entry.verdict === 'review');
const byLicense = new Map<string, number>();
for (const entry of sorted) byLicense.set(entry.license, (byLicense.get(entry.license) ?? 0) + 1);

const escape = (value: string) => value.replace(/\|/g, '\\|');
const statusLabel = (verdict: Verdict) =>
  verdict === 'allowed' ? 'ok' : verdict === 'review' ? 'weak copyleft — review' : 'NOT IN ALLOW-LIST';

const lines: string[] = [
  '# Dependency licenses',
  '',
  `Generated by \`bun run license:audit\` (\`scripts/license-audit.ts\`) on ${new Date().toISOString().slice(0, 10)}.`,
  '',
  'Scope: production dependencies reachable from the `dependencies` (and installed `optionalDependencies`) of',
  `${roots.map((r) => `\`${r}/package.json\``).join(', ')}, resolved transitively from the installed \`node_modules\`.`,
  'Dev dependencies (build tools, type checkers, test runners) are not shipped and are not listed.',
  'First-party packages (`@cockpit/*`) are AGPL-3.0-or-later / commercial and are traversed but not listed.',
  '',
  `Allow-list: ${[...allowed].join(', ')}. Weak copyleft (reviewed, not blocking): ${[...weakCopyleft].join(', ')}.`,
  '',
  '## Summary',
  '',
  `- Packages: **${sorted.length}**`,
  `- Not in allow-list: **${flagged.length}**`,
  `- Weak copyleft to review: **${review.length}**`,
  '',
  '| License | Packages |',
  '| --- | ---: |',
  ...[...byLicense.entries()].sort((a, b) => b[1] - a[1]).map(([license, count]) => `| ${escape(license)} | ${count} |`),
  '',
];

if (missingRequired.length) {
  lines.push('## Unresolved dependencies', '', 'Run `bun run install:all` and re-run the audit.', '');
  for (const item of missingRequired) lines.push(`- ${item}`);
  lines.push('');
}

const noted = sorted.filter((entry) => noteFor(entry.name));
if (flagged.length || review.length || noted.length) {
  lines.push('## Items that need attention', '');
  for (const entry of [...flagged, ...review, ...noted.filter((e) => e.verdict === 'allowed')]) {
    const note = noteFor(entry.name);
    lines.push(`- **${entry.name}@${entry.version}** — ${entry.license} (${statusLabel(entry.verdict)})${note ? `. ${note}` : ''}`);
  }
  lines.push('');
}

lines.push('## All packages', '', '| Package | Version | License | Status | Used by |', '| --- | --- | --- | --- | --- |');
for (const entry of sorted) {
  lines.push(`| ${escape(entry.name)} | ${entry.version} | ${escape(entry.license)} | ${statusLabel(entry.verdict)} | ${[...entry.usedBy].sort().join(', ')} |`);
}
lines.push('');

const output = join(repoRoot, 'docs', 'dependency-licenses.md');
writeFileSync(output, lines.join('\n'));
console.log(`${sorted.length} packages, ${flagged.length} not in allow-list, ${review.length} weak copyleft → ${relative(repoRoot, output)}`);
for (const entry of flagged) console.log(`  FLAG   ${entry.name}@${entry.version} ${entry.license}`);
for (const entry of review) console.log(`  REVIEW ${entry.name}@${entry.version} ${entry.license}`);
if (missingRequired.length) console.log(`  unresolved: ${missingRequired.join(', ')}`);
