#!/usr/bin/env node
//
// baseline.mjs — runs every Task 2 check and snapshots current violations to
// doc/lint/baseline.json (Style Guide Part F.0, "no new violations" while the
// backlog is worked down). Node built-ins only, no dependencies.
//
// Each check contributes a `count` and a `fingerprints` array (stable
// per-finding strings) so a later comparator (check-no-new-violations.mjs)
// can diff a fresh run against this snapshot and flag genuinely new
// findings, independent of how many pre-existing ones remain.
//
// Usage: node doc/lint/baseline.mjs [--skip-a11y] [outFile]
//   outFile defaults to doc/lint/baseline.json; check-no-new-violations.mjs
//   passes a temp path so a comparison run doesn't clobber the committed one.
//
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(DOC_DIR, '..');
const cliArgs = process.argv.slice(2);
const skipA11y = cliArgs.includes('--skip-a11y');
const outArg = cliArgs.find((a) => !a.startsWith('--'));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return r;
}

function valeFingerprints(target) {
  const r = run('vale', ['--output=JSON', target], { cwd: DOC_DIR });
  let parsed = {};
  try { parsed = JSON.parse(r.stdout || '{}'); } catch { /* vale prints nothing useful */ }
  const fingerprints = [];
  for (const [file, alerts] of Object.entries(parsed)) {
    for (const a of alerts) fingerprints.push(`${path.relative(DOC_DIR, file)}:${a.Line}:${a.Check}`);
  }
  return { count: fingerprints.length, fingerprints: fingerprints.sort() };
}

function docLintFingerprints() {
  const r = run('node', [path.join(SCRIPT_DIR, 'doc-lint.mjs')]);
  const parsed = JSON.parse(r.stdout || '{"summary":{},"findings":{}}');
  const fingerprints = [];
  for (const [check, items] of Object.entries(parsed.findings || {})) {
    for (const it of items) fingerprints.push(`${check}:${it.file}:${it.line ?? ''}:${it.message}`);
  }
  return { count: fingerprints.length, byRule: parsed.summary, fingerprints: fingerprints.sort() };
}

function mrdocsFingerprints() {
  const r = run('node', [path.join(SCRIPT_DIR, 'mrdocs-warnings.mjs')]);
  let parsed = {};
  try { parsed = JSON.parse(r.stdout || '{}'); } catch { /* fall through */ }
  if (parsed.error) return { count: 0, skipped: true, reason: parsed.error, fingerprints: [] };
  const fingerprints = (parsed.findings || []).map((f) => `${f.file ?? '?'}:${f.line ?? ''}:${f.message}`);
  return { count: fingerprints.length, fingerprints: fingerprints.sort() };
}

function a11yFingerprints() {
  const r = run('node', [path.join(SCRIPT_DIR, 'run-a11y.mjs')]);
  let parsed = {};
  try { parsed = JSON.parse(r.stdout || '{}'); } catch { /* fall through */ }
  if (parsed.error) return { count: 0, skipped: true, reason: parsed.error, fingerprints: [] };
  const fingerprints = (parsed.findings || []).map((f) => `${f.url}:${f.code}:${f.selector}`);
  return {
    count: fingerprints.length,
    contrastCount: parsed.summary?.contrast ?? fingerprints.filter((f) => f.includes(':color-contrast:')).length,
    fingerprints: fingerprints.sort(),
  };
}

const results = {};
results.vale_adoc = valeFingerprints('modules');

run('node', [path.join(SCRIPT_DIR, 'extract-docstrings.mjs')]);
results.vale_docstrings = valeFingerprints('lint/.docstrings');

results.doc_lint = docLintFingerprints();
results.mrdocs_warnings = mrdocsFingerprints();
results.a11y = skipA11y ? { count: 0, skipped: true, reason: '--skip-a11y' } : a11yFingerprints();

const baseline = {
  generatedAt: new Date().toISOString(),
  note: 'Snapshot of current violations (Task 2, Style Guide Part F.0). Non-blocking: ' +
        'this records the backlog so a future comparator can flag NEW findings without ' +
        'failing on the ones already known about.',
  checks: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
    count: v.count, skipped: v.skipped || false, reason: v.reason,
    byRule: v.byRule, contrastCount: v.contrastCount,
    fingerprints: v.fingerprints,
  }])),
};

const outPath = outArg ? path.resolve(outArg) : path.join(SCRIPT_DIR, 'baseline.json');
fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');
console.log(JSON.stringify({
  written: path.relative(REPO_ROOT, outPath),
  summary: Object.fromEntries(Object.entries(baseline.checks).map(([k, v]) => [k, v.skipped ? 'skipped' : v.count])),
}, null, 2));
