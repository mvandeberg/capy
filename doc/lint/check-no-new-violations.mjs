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
// --strict to exit 1 when new violations are found.
//
// --gate <check>:<rule-regex>  restricts what counts as blocking to a named
// set of (check, rule-regex) pairs — the phase-exit gate-promotion mechanism.
// Repeatable. Each value is split on its FIRST ':' into a check name and a
// regex tested against that check's fingerprints. In gate mode BOTH the exit
// condition and the skip check are filtered: only NEW fingerprints of a gated
// check that match its regex block, and only a skip of a GATED check fails the
// run ("can't verify a gated rule = not a pass"); skips of non-gated checks
// (a11y, mrdocs, vale_docstrings) are reported but do not block. Without
// --gate the comparator stays omnibus (the non-blocking report step).
//
// Phase-1 exit gate spec (A1/A6/A7/B2/D2):
//   --gate 'doc_lint:^(A1|A6|B2|D2):' --gate 'vale_adoc:Capy\.PartHeadings$'
//   (A1/A6/B2/D2 come from doc_lint; A7 is the Vale rule Capy.PartHeadings.)
//
// Usage: node doc/lint/check-no-new-violations.mjs [--strict] [--gate spec ...] [--skip-a11y]
//
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');

// Parse --gate specs; everything else (except --strict) is passed through to
// baseline.mjs. NB: --gate values must NOT reach baseline.mjs, whose first
// non-flag arg is taken as the output path.
const gateByCheck = new Map(); // check -> [RegExp]
const extraArgs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--strict') continue;
  let spec = null;
  if (a === '--gate') spec = argv[++i];
  else if (a.startsWith('--gate=')) spec = a.slice('--gate='.length);
  if (spec != null) {
    const idx = spec.indexOf(':');
    if (idx < 0) {
      console.error(`--gate expects <check>:<rule-regex>, got: ${spec}`);
      process.exit(2);
    }
    const check = spec.slice(0, idx);
    const re = new RegExp(spec.slice(idx + 1));
    if (!gateByCheck.has(check)) gateByCheck.set(check, []);
    gateByCheck.get(check).push(re);
    continue;
  }
  extraArgs.push(a);
}
const gated = gateByCheck.size > 0;

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

let totalNew = 0;        // omnibus: new findings across ALL checks (report semantics)
let anySkipped = false;  // any check skipped at all
let gatedNew = 0;        // new findings in gated checks matching a gate regex
let gatedSkipped = false; // a GATED check was skipped (can't verify => gate fails)
const gatedFindings = []; // the specific gated new fingerprints (named in the log)
const report = {};
for (const [check, currentCheck] of Object.entries(current.checks)) {
  const gateRes = gateByCheck.get(check) || null;
  // A skipped check (Vale broken, MrDocs/a11y couldn't run, ...) is NOT a clean pass — it
  // means no comparison happened at all. Surface it loudly (stderr, outside the JSON blob)
  // so it can't be mistaken for "0 new" in a log that only skims the summary line, and
  // record it distinctly (newCount: null, not 0) in the JSON report too. A skip of a GATED
  // check additionally fails the gate: an unverifiable gated rule is not a pass.
  if (currentCheck.skipped) {
    anySkipped = true;
    if (gateRes) gatedSkipped = true;
    console.error(`SKIPPED: ${check} (${currentCheck.reason}) — no-new-violations comparison NOT performed for this check.${gateRes ? ' [GATED — fails the gate]' : ''}`);
    report[check] = {
      skipped: true, reason: currentCheck.reason, gated: !!gateRes,
      baselineCount: baseline.checks[check]?.count ?? 0, currentCount: currentCheck.count,
      newCount: null, newFindings: [],
    };
    continue;
  }
  const baseSet = new Set(baseline.checks[check]?.fingerprints || []);
  const newOnes = (currentCheck.fingerprints || []).filter((fp) => !baseSet.has(fp));
  totalNew += newOnes.length;
  const entry = { baselineCount: baseline.checks[check]?.count ?? 0, currentCount: currentCheck.count, newCount: newOnes.length, newFindings: newOnes };
  if (gateRes) {
    const gatedOnes = newOnes.filter((fp) => gateRes.some((re) => re.test(fp)));
    entry.gated = true;
    entry.gatedNewCount = gatedOnes.length;
    entry.gatedNewFindings = gatedOnes;
    gatedNew += gatedOnes.length;
    for (const fp of gatedOnes) gatedFindings.push(`${check} :: ${fp}`);
  }
  report[check] = entry;
}

if (anySkipped) {
  console.error(`SKIPPED checks present — totalNew (${totalNew}) is only valid for the checks that actually ran.`);
}

// The blocking condition: gated slice when --gate is present, omnibus otherwise.
const blockingNew = gated ? gatedNew : totalNew;
const blockingSkip = gated ? gatedSkipped : anySkipped;
if (gated && blockingNew > 0) {
  console.error(`GATE: ${blockingNew} new gated violation(s):`);
  for (const f of gatedFindings) console.error(`  - ${f}`);
}

console.log(JSON.stringify({
  totalNew, anySkipped, strict,
  gated, gatedNew: gated ? gatedNew : undefined, gatedSkipped: gated ? gatedSkipped : undefined,
  gatedFindings: gated ? gatedFindings : undefined,
  checks: report,
}, null, 2));
process.exit(strict && (blockingNew > 0 || blockingSkip) ? 1 : 0);
