#!/usr/bin/env node
//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//
// selftest.mjs — asserts that sentence-length.mjs and doc-lint.mjs's B2 check
// still detect what they claim to, against the checked-in corpus in
// lint/fixtures/ (sentence-length.mjs) or a throwaway fixture tree built at
// run time (doc-lint.mjs's B2 section). Node built-ins only. Exit 0 = all
// assertions hold; exit 1 = at least one broke, with the failure named. Run
// it after any edit to sentence-length.mjs or doc-lint.mjs.
//
// Why this exists. The C2 checker is on its way to becoming a merge-blocking
// gate, and the properties below are exactly the ones whose failure is SILENT:
// nothing in the real corpus exercises them, so a plausible refactor can retire
// a protection and every downstream number still looks reasonable. Two such
// refactors were demonstrated on the unbalanced-backtick guard alone — making
// the backtick pattern lenient returns the diagnostic count to 0 and makes a
// 30-word sentence vanish with no finding at all, and renaming the rule's `id`
// without updating maskBlock()'s skip string keeps the diagnostic but silently
// drops the count correction. Both pass every corpus-level check. Neither passes
// this file.
//
// Fixtures live in lint/fixtures/ and are NOT part of either linted corpus:
// Vale runs on `modules` and `lint/.docstrings` only, and Antora reads
// modules/ via antora.yml, so nothing else sees them.
//
// Usage: node doc/lint/selftest.mjs
//
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(SCRIPT_DIR, '..');
const FIXTURES = path.join(SCRIPT_DIR, 'fixtures', 'modules');

const r = spawnSync('node', [path.join(SCRIPT_DIR, 'sentence-length.mjs'), FIXTURES],
  { encoding: 'utf8', cwd: DOC_DIR, maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) {
  console.error(`selftest: sentence-length.mjs exited ${r.status}\n${r.stderr || r.stdout}`);
  process.exit(1);
}
const out = JSON.parse(r.stdout);
const hard = out.findings.C2;
const advisory = out.findings['advisory-C2'];
const backtick = out.findings.BACKTICK;

// A finding is identified by the first word of its sentence, which is unique per
// fixture and survives a change to line numbering.
const lead = (f) => f.sentence.replace(/^[^A-Za-z`]*/, '').split(/[\s`]+/)[0];
const find = (arr, word) => arr.filter((f) => lead(f) === word);

const failures = [];
function check(name, cond, detail) {
  if (cond) return;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function one(name, arr, word, words) {
  const hits = find(arr, word);
  if (hits.length !== 1) {
    failures.push(`${name} — expected exactly 1 finding leading with '${word}', got ${hits.length}`);
    return;
  }
  check(name, hits[0].words === words, `'${word}' measured ${hits[0].words} words, expected ${words}`);
}
function none(name, arr, word) {
  const hits = find(arr, word);
  check(name, hits.length === 0,
    `expected no finding leading with '${word}', got ${hits.length} (${hits.map((h) => `${h.words}w`).join(', ')})`);
}

// 1. The unbalanced-backtick guard. Both halves matter: the diagnostic must be
//    emitted AND the sentence must still be measured at its full length. A
//    lenient backtick pattern loses both; a stale skip id loses only the second.
one('backtick guard: sentence measured at full length', hard, 'One', 30);
check('backtick guard: diagnostic emitted', backtick.length === 1,
  `expected 1 BACKTICK finding, got ${backtick.length}`);
check('backtick guard: summary counts it', out.summary.unbalancedBackticks === 1,
  `summary.unbalancedBackticks = ${out.summary.unbalancedBackticks}`);

// 2. The two UNDER-reporting cases. These are the only known ways a real
//    violation can slip through, so they are the assertions that protect the
//    gate's floor rather than its ceiling.
one('mid-sentence ellipsis does not split the sentence', hard, 'Alpha', 34);
one('parenthesised abbreviation does not split the sentence', hard, 'Aone', 31);

// 3. Bold run-in lead is its own sentence, so neither half is over the limit.
none('bold run-in lead does not merge into the next sentence', hard, 'The');

// 4. Reader word counting. 30 tokens under the retired Vale token, 25 as a
//    reader counts, so any regression in the connector set makes this fire.
none('reader word counting keeps a 25-word sentence under the limit', hard, 'most-derived');

// 5. Code blocks are not prose.
check('code blocks are not linted as prose',
  !JSON.stringify(out.findings).includes('utilize_and_leverage'),
  'a [source,cpp] block reached the linter');

// 6. The hard/advisory partition, in both directions, including the look-alike
//    directory that must NOT be treated as an essay.
one('9.design/ findings are advisory', advisory, 'Advisory', 28);
none('9.design/ findings are not in the hard slice', hard, 'Advisory');
one('a 9.designish/ look-alike stays in the hard slice', hard, 'Lookalike', 28);

// 7. The gate-reachability property itself, tested on the rule keys rather than
//    asserted in a comment: a `^C2:` spec must reach the hard key and nothing
//    else, whatever the keys are renamed to.
const GATE = /^C2:/;
const keys = Object.keys(out.findings);
check('rule keys are C2 / advisory-C2 / BACKTICK', keys.join(',') === 'C2,advisory-C2,BACKTICK',
  `got '${keys.join(',')}'`);
check('only the hard key is reachable from a ^C2: gate spec',
  keys.filter((k) => GATE.test(`${k}:some/file.adoc:#1:message`)).join(',') === 'C2',
  `reachable keys: '${keys.filter((k) => GATE.test(`${k}:f:#1:m`)).join(',')}'`);

// 8. extract-docstrings.mjs covers BOTH Doxygen comment forms. `///` runs were
//    invisible to every gate until 2026-08 — 86 published doc lines across 25
//    headers, and the gap surfaced only because a bite test happened to plant its
//    first probe in a `///` comment. A tightened regex or a reverted branch would
//    retire the coverage silently: the corpus just gets smaller, every count drops,
//    and nothing reads as broken. The expectations below are DERIVED from the real
//    header tree rather than written down, so they cannot go stale.
const INCLUDE_ROOT = path.resolve(DOC_DIR, '..', 'include/boost/capy');
const TMP_OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-selftest-docstrings-'));
try {
  const walkHpp = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkHpp(p) : (e.name.endsWith('.hpp') ? [p] : []);
  });
  // Headers whose ONLY doc comments are `///` runs: they have no output file at all
  // unless the `///` branch works, which makes them the sharpest available probe.
  const slashOnly = walkHpp(INCLUDE_ROOT).filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return /^[ \t]*\/\/\/(?!\/)/m.test(t) && !t.includes('/**');
  }).map((f) => `${path.relative(INCLUDE_ROOT, f)}.adoc`);

  const x = spawnSync('node', [path.join(SCRIPT_DIR, 'extract-docstrings.mjs'), TMP_OUT],
    { encoding: 'utf8', cwd: DOC_DIR, maxBuffer: 16 * 1024 * 1024 });
  check('extract-docstrings.mjs exits 0', x.status === 0, `exited ${x.status}: ${(x.stderr || '').trim().slice(-200)}`);
  check('extract-docstrings.mjs finds some `///`-only headers to prove the branch on',
    slashOnly.length > 0, 'no header in the tree has `///` docs and no `/** */` block');
  const missing = slashOnly.filter((rel) => !fs.existsSync(path.join(TMP_OUT, rel)));
  check('`///` doc comments are extracted', missing.length === 0,
    `${missing.length} of ${slashOnly.length} `
    + `\`///\`-only header(s) produced no output: ${missing.slice(0, 3).join(', ')}`);
} finally {
  fs.rmSync(TMP_OUT, { recursive: true, force: true });
}

// 9. doc-lint.mjs's B2 check ("no code block holds raw code") must reach
//    every [source,<lang>] block, not just [source,cpp]/[source,c++] — that
//    was the whole gap a prior widening closed — and must also reach bare
//    `----` listings, while leaving role=pseudocode/external/output/diagram
//    and include::example$ blocks alone. There was previously no self-test
//    coverage for doc-lint.mjs at all, so a regex narrowed back to one
//    language, or a bare-listing branch that stopped firing, would pass
//    every corpus-level check silently. Exercised against a throwaway
//    fixture tree (not lint/fixtures/, which only sentence-length.mjs reads)
//    so a real corpus edit can't perturb these counts.
{
  const DOCLINT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-selftest-doclint-'));
  try {
    const write = (rel, body) => {
      const fp = path.join(DOCLINT_TMP, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, body);
    };
    // One [source,cmake] block with no clearing role (the original escape:
    // the old regex only matched cpp/c++) and one bare `----` block with no
    // role=output/role=diagram marker and real code in it (the other
    // escape: bare listings were invisible to any [source,...] regex).
    write('flagged.adoc', [
      ':page-mode: how-to',
      '',
      '= Flagged',
      '',
      '[source,cmake]',
      '----',
      'add_executable(x x.cpp)',
      '----',
      '',
      '----',
      'int x = 1;',
      '----',
      '',
    ].join('\n'));
    // Every exemption B2 recognizes, one of each, all in a single page that
    // must produce zero findings.
    write('clear.adoc', [
      ':page-mode: how-to',
      '',
      '= Clear',
      '',
      '[source,cmake,role=pseudocode]',
      '----',
      'add_executable(x x.cpp)',
      '----',
      '',
      '[role=output]',
      '----',
      'build succeeded',
      '----',
      '',
      '[role=diagram]',
      '----',
      '[A] --> [B]',
      '----',
      '',
      '[source,cpp]',
      '----',
      'include::example$foo.cpp[tag=bar]',
      '----',
      '',
    ].join('\n'));

    const d = spawnSync('node', [path.join(SCRIPT_DIR, 'doc-lint.mjs'), DOCLINT_TMP],
      { encoding: 'utf8', cwd: DOC_DIR, maxBuffer: 16 * 1024 * 1024 });
    check('doc-lint.mjs exits 0 against the B2 fixture tree', d.status === 0,
      `exited ${d.status}: ${(d.stderr || '').trim().slice(-200)}`);
    let dOut = null;
    try { dOut = JSON.parse(d.stdout); } catch { /* reported below */ }
    check('doc-lint.mjs prints parseable JSON', dOut !== null, `stdout: ${d.stdout.slice(0, 200)}`);
    if (dOut) {
      const flaggedHits = dOut.findings.B2.filter((f) => f.file === 'flagged.adoc');
      check('B2 catches a raw [source,cmake] block, not just [source,cpp]/[source,c++]',
        flaggedHits.length === 2, `flagged.adoc B2 findings: ${JSON.stringify(flaggedHits)}`);
      check('B2 catches a bare `----` block holding real code with no role marker',
        flaggedHits.some((f) => f.line === 10),
        `expected a finding at flagged.adoc:10 (the bare block); got: ${JSON.stringify(flaggedHits)}`);
      const clearHits = dOut.findings.B2.filter((f) => f.file === 'clear.adoc');
      check('B2 leaves role=pseudocode/external/output/diagram and include::example$ alone',
        clearHits.length === 0, `clear.adoc should have 0 B2 findings, got: ${JSON.stringify(clearHits)}`);
    }
  } finally {
    fs.rmSync(DOCLINT_TMP, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`selftest: ${failures.length} assertion(s) FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  assertions: 22,
  fixtureSummary: out.summary,
}, null, 2));
