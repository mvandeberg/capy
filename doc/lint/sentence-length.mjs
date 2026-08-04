#!/usr/bin/env node
//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//
// sentence-length.mjs — the authority for Style Guide C2 ("no sentence over 25
// words"), replacing Vale's `Capy.SentenceLength` on both documentation
// surfaces. Node built-ins only, no dependencies. JSON on stdout, in the same
// shape doc-lint.mjs uses, so baseline.mjs can fingerprint it.
//
// Why this exists rather than a Vale rule
// ---------------------------------------
// `Capy.SentenceLength` is `extends: occurrence`, `scope: sentence`, and it runs
// AFTER doc/.vale.ini's `TokenIgnores` blanks inline code spans. Two defects
// follow from that, both measured on this branch and neither fixable inside a
// Vale rule:
//
//   1. UNDER-COUNTING. A blanked span contributes ZERO words where a reader
//      counts at least one, so the rule's 25-word budget is not the reader's.
//      Measured over `modules`: 140 alerts as configured versus 170 with spans
//      counted as one word each (+21%), of which the backtick clause accounts
//      for +27 and the `cpp:` clause +3 (task P4-prereq).
//   2. MIS-ATTRIBUTION, which is worse. The blanking corrupts Vale's position
//      mapping for `scope: sentence` rules, so an alert can be reported against
//      the wrong block — which makes a genuinely over-limit block look
//      unreported, and it produces no alert of its own to chase. Iterating
//      `extract + vale` to a fixpoint does NOT find it. Real case, extracted
//      from `concept/executor.hpp` at a2b9eb72: Vale flagged a 21-token block at
//      line 31, which cannot exceed 25, and said nothing about the 43-token
//      block at line 18.
//
// So this checker does its own segmentation and its own counting, and never
// asks Vale where anything is. `TokenIgnores` in .vale.ini is deliberately left
// alone: 557 `cpp:` macros depend on it for the rules that SHOULD ignore symbol
// text. The fix is to stop depending on Vale's position mapping for C2, not to
// remove the ignores.
//
// How a code span is counted
// --------------------------
// As the one word a reader sees. A construct is masked with U+0001 runs of the
// SAME LENGTH as the original, leaving a single `x` behind, so that
//
//   * the offsets of everything after it stay valid, which is what lets a
//     finding quote the real source text and name the real line, and
//   * `\b(\w+)\b` — the same token the Vale rule used — counts it exactly once.
//
// `xref:`/link macros are masked around their bracketed text instead: a reader
// sees the link text, so the link text is what gets counted.
//
// Usage: node doc/lint/sentence-length.mjs [--max N] [corpusDir ...]
//   Corpora default to `modules` (the Antora pages) and `lint/.docstrings` (the
//   header docstrings, produced by extract-docstrings.mjs), both relative to
//   doc/. A missing or empty corpus is a HARD ERROR (exit 1), never a clean
//   zero: this branch has eight recorded instances of a check that looked
//   healthy while checking less than it appeared to, and "the corpus silently
//   scanned no files" is the cheapest way to add a ninth.
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_CORPORA = ['modules', 'lint/.docstrings'];

const argv = process.argv.slice(2);
let max = 25;
const corpora = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--max') max = Number(argv[++i]);
  else if (argv[i].startsWith('--max=')) max = Number(argv[i].slice('--max='.length));
  else corpora.push(argv[i]);
}
if (!Number.isInteger(max) || max < 1) {
  console.error(`--max expects a positive integer, got: ${max}`);
  process.exit(2);
}
if (corpora.length === 0) corpora.push(...DEFAULT_CORPORA);

function walk(dir) {
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(walk(p));
    else if (ent.name.endsWith('.adoc')) out.push(p);
  }
  return out;
}

// --- prose extraction ------------------------------------------------------
//
// Delimited blocks whose content is NOT prose. Their content is skipped
// wholesale — handing code to a prose linter is the `BlockIgnores` mistake
// .vale.ini documents at length, and it is not repeated here. Note that
// `====` (example), `____` (quote) and `****` (sidebar) blocks DO hold prose
// and are only unit boundaries; `--` open blocks do not occur in this corpus.
const OPAQUE_OPEN = /^(-{4,}|\.{4,}|\+{4,}|\/{4,})$/;
const TABLE_DELIM = /^[|,!]===$/;

// Lines that carry no prose of their own. Headings are included: a heading is
// not a sentence, and the longest in the corpus is nowhere near 25 words.
const SKIP_LINE = new RegExp([
  '^//',                              // line comment
  '^:[^\\s:]+:',                      // document attribute
  '^\\[.*\\]$',                       // block attribute, or [[anchor]]
  '^(include|ifdef|ifndef|ifeval|endif|image|video|audio|toc)::',
  '^=+\\s',                           // heading
  '^(={4,}|_{4,}|\\*{4,}|\'{3,})$',   // prose-block delimiters and thematic break
  '^\\+$',                            // list continuation
].join('|'));

// A leading list, callout or ordered-list marker. The item after it is its own
// block to asciidoctor, hence its own sentence scope.
const LIST_MARKER = /^(?:[*.]{1,5}|-|\d+\.|<\d+>|<\.>)\s+/;

// Collect the prose blocks of one file as { line, text }, where `line` is the
// 1-based line the block starts on and `text` is its lines joined with a single
// space. `map` records where each source line begins inside `text`, so a
// sentence found mid-block can still be reported against the line it starts on.
function proseBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  let opaque = null; // RegExp that closes the opaque block we are inside
  let inTable = false;

  const open = (lineNo, s) => { cur = { line: lineNo, text: s, map: [{ at: 0, line: lineNo }] }; };
  const append = (lineNo, s) => {
    if (cur === null) return open(lineNo, s);
    cur.text += ' ';
    cur.map.push({ at: cur.text.length, line: lineNo });
    cur.text += s;
  };
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null; };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const t = lines[i].trim();
    if (opaque !== null) { if (opaque.test(t)) opaque = null; continue; }
    if (t === '') { flush(); continue; }
    if (TABLE_DELIM.test(t)) { flush(); inTable = !inTable; continue; }
    if (OPAQUE_OPEN.test(t)) {
      flush();
      // Close on the same delimiter character; asciidoctor wants matching
      // lengths, but being lenient here cannot swallow the rest of the file.
      opaque = new RegExp(`^\\${t[0]}{4,}$`);
      continue;
    }
    if (SKIP_LINE.test(t)) { flush(); continue; }
    if (inTable && t.startsWith('|')) {
      // Every `|` on the row opens a cell, and a cell is its own prose block.
      // The last cell stays open so a cell continued on the next line folds in.
      flush();
      const cells = t.split('|').slice(1);
      for (let k = 0; k < cells.length; k++) {
        const cell = cells[k].trim();
        if (!cell) continue;
        if (k === cells.length - 1) open(lineNo, cell);
        else out.push({ line: lineNo, text: cell, map: [{ at: 0, line: lineNo }] });
      }
      continue;
    }
    const marker = LIST_MARKER.exec(t);
    if (marker) { flush(); open(lineNo, t.slice(marker[0].length)); continue; }
    append(lineNo, t);
  }
  flush();
  return out;
}

// --- masking ---------------------------------------------------------------
//
// Each rule replaces its match with a same-length string. `keep: false` leaves
// one `x` (the single word a reader sees); `keep: true` leaves capture group 1
// (a link's visible text) and hides the rest. Order matters: the macros come
// first so that a backtick span inside a macro's link text is not eaten by the
// backtick rule, and an already-masked region cannot re-match because U+0001 is
// in none of the patterns.
const SPANS = [
  { re: /\b(?:xref|link|kbd|btn|menu|footnote):[^\s[]*\[([^\]]*)\]/g, keep: true },
  { re: /\bhttps?:\/\/\S*?\[([^\]]*)\]/g, keep: true },
  { re: /\b(?:cpp|image|icon|pass):[^\s[]*\[[^\]]*\]/g, keep: false },
  { re: /``[^`]+``|`[^`\n]+`/g, keep: false },
  { re: /\{[a-z][\w-]*\}/g, keep: false }, // attribute reference, e.g. {cpp}
];

const hide = (n) => ''.repeat(n);

function mask(s) {
  let out = s;
  for (const { re, keep } of SPANS) {
    out = out.replace(re, (m, g1) => {
      if (keep && g1) {
        const at = m.indexOf(g1);
        return hide(at) + g1 + hide(m.length - at - g1.length);
      }
      return `x${hide(m.length - 1)}`;
    });
  }
  return out;
}

// --- segmentation ----------------------------------------------------------
//
// Terminal punctuation followed by whitespace or end of block, on the MASKED
// text — so a `.` inside a code span or a URL cannot open a sentence boundary.
// Abbreviations that legitimately end in a period are not boundaries.
const BOUNDARY = /[.!?][)"'’”]*(?=\s|$)/g;
const ABBREV = /(?:\b(?:e\.g|i\.e|etc|vs|cf|al|resp|approx|Dr|Mr|Mrs|Ms|Fig|No|Ch|Sec|Eq)\.|\s[A-Z]\.)$/;

function sentenceRanges(masked) {
  const out = [];
  let start = 0;
  let m;
  BOUNDARY.lastIndex = 0;
  while ((m = BOUNDARY.exec(masked)) !== null) {
    const end = m.index + m[0].length;
    if (ABBREV.test(masked.slice(start, end))) continue;
    out.push([start, end]);
    start = end;
  }
  if (masked.slice(start).trim()) out.push([start, masked.length]);
  return out;
}

const countWords = (s) => (s.match(/\b(\w+)\b/g) || []).length;

// --- run -------------------------------------------------------------------

const findings = [];
const scanned = {};
for (const corpus of corpora) {
  const root = path.resolve(DOC_DIR, corpus);
  if (!fs.existsSync(root)) {
    console.error(`sentence-length.mjs: corpus '${corpus}' does not exist at ${root}. ` +
      "For 'lint/.docstrings', run `node lint/extract-docstrings.mjs` first. " +
      'Refusing to report zero findings for a corpus that was never read.');
    process.exit(1);
  }
  const files = walk(root);
  if (files.length === 0) {
    console.error(`sentence-length.mjs: corpus '${corpus}' contains no .adoc files. ` +
      'Refusing to report zero findings for an empty corpus.');
    process.exit(1);
  }
  scanned[corpus] = files.length;
  for (const file of files) {
    // Keyed on the path relative to DOC_DIR, never a basename: `concept/read_stream.hpp`
    // and `test/read_stream.hpp` are different files, and two verification scripts on
    // this branch silently conflated exactly that pair.
    const rel = path.relative(DOC_DIR, file).split(path.sep).join('/');
    for (const block of proseBlocks(fs.readFileSync(file, 'utf8'))) {
      const masked = mask(block.text);
      for (const [from, to] of sentenceRanges(masked)) {
        const words = countWords(masked.slice(from, to));
        if (words <= max) continue;
        let line = block.line;
        for (const e of block.map) if (e.at <= from) line = e.line;
        findings.push({
          file: rel,
          line,
          words,
          // The message is deliberately fixed text: baseline.mjs fingerprints a
          // doc_lint-shaped finding as `rule:file:#N:message`, and folding the
          // word count or the sentence into it would re-mint the fingerprint on
          // every reword — a gate that fails because a contributor rephrased an
          // already-over-limit sentence teaches contributors to distrust it.
          message: `sentence over ${max} words`,
          sentence: block.text.slice(from, to).trim(),
        });
      }
    }
  }
}

console.log(JSON.stringify({
  summary: { C2: findings.length, max, scanned },
  findings: { C2: findings },
}, null, 2));
process.exit(0);
