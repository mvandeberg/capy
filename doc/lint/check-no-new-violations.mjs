#!/usr/bin/env node
//
// check-no-new-violations.mjs — the "no NEW violations" gate the Task 2
// brief's acceptance criterion describes: a fresh check run is diffed
// against doc/lint/baseline.json (Style Guide Part F.0) per-check
// fingerprint sets, and anything not already in the baseline is reported as
// new. This is what would catch a newly introduced banned word ("utilize")
// or a newly undocumented @param, without re-flagging the existing backlog.
//
// Node built-ins only. Regenerates a fresh snapshot via baseline.mjs into a
// temp file (never overwrites the committed baseline.json) and compares.
//
// Non-blocking by default (Task 2: everything stays warning-mode). Pass
// --strict to exit 1 when new violations are found — for later phase-exit
// gate promotion (see the brief's promotion schedule); unused today.
//
// Usage: node doc/lint/check-no-new-violations.mjs [--strict] [--skip-a11y]
//
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes('--strict');
const extraArgs = process.argv.slice(2).filter((a) => a !== '--strict');

const baselinePath = path.join(SCRIPT_DIR, 'baseline.json');
if (!fs.existsSync(baselinePath)) {
  console.log(JSON.stringify({ error: `no baseline.json at ${baselinePath} — run baseline.mjs first` }, null, 2));
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const tmpPath = path.join(os.tmpdir(), `doc-lint-current-${process.pid}.json`);
const r = spawnSync('node', [path.join(SCRIPT_DIR, 'baseline.mjs'), ...extraArgs, tmpPath], { encoding: 'utf8' });
if (r.status !== 0 || !fs.existsSync(tmpPath)) {
  console.log(JSON.stringify({ error: 'failed to generate a current snapshot', stderr: r.stderr }, null, 2));
  process.exit(0);
}
const current = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
fs.rmSync(tmpPath, { force: true });

let totalNew = 0;
let anySkipped = false;
const report = {};
for (const [check, currentCheck] of Object.entries(current.checks)) {
  // A skipped check (Vale broken, MrDocs/a11y couldn't run, ...) is NOT a clean pass — it
  // means no comparison happened at all. Surface it loudly (stderr, outside the JSON blob)
  // so it can't be mistaken for "0 new" in a log that only skims the summary line, and
  // record it distinctly (newCount: null, not 0) in the JSON report too.
  if (currentCheck.skipped) {
    anySkipped = true;
    console.error(`SKIPPED: ${check} (${currentCheck.reason}) — no-new-violations comparison NOT performed for this check.`);
    report[check] = {
      skipped: true, reason: currentCheck.reason,
      baselineCount: baseline.checks[check]?.count ?? 0, currentCount: currentCheck.count,
      newCount: null, newFindings: [],
    };
    continue;
  }
  const baseSet = new Set(baseline.checks[check]?.fingerprints || []);
  const newOnes = (currentCheck.fingerprints || []).filter((fp) => !baseSet.has(fp));
  totalNew += newOnes.length;
  report[check] = { baselineCount: baseline.checks[check]?.count ?? 0, currentCount: currentCheck.count, newCount: newOnes.length, newFindings: newOnes };
}

if (anySkipped) {
  console.error(`SKIPPED checks present — totalNew (${totalNew}) is only valid for the checks that actually ran.`);
}

console.log(JSON.stringify({ totalNew, anySkipped, strict, checks: report }, null, 2));
process.exit(strict && (totalNew > 0 || anySkipped) ? 1 : 0);
