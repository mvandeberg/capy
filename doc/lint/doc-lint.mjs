#!/usr/bin/env node
//
// doc-lint.mjs — structural checks Vale cannot express (Style Guide Part F).
// Node built-ins only, no dependencies. Exit 0 always (warning mode, Task 2);
// findings are emitted as JSON on stdout for `baseline.json` / CI to consume.
//
// Checks:
//   A1 — every page under pages/ declares :page-mode:
//   A6 — quick-start is within the first 3 top-level nav.adoc entries
//   B2 — no [source,cpp] block holds raw code (must start with
//        include::example$... or carry role=pseudocode/role=external)
//   D2 — every tutorial/concept page has >=1 include::example$
//
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PAGES_DIR = path.join(ROOT, 'modules/ROOT/pages');
const NAV_FILE = path.join(ROOT, 'modules/ROOT/nav.adoc');

// Directories whose pages are concept/tutorial material for D2's heuristic.
// :page-mode: is authoritative when present; this is the fallback used until
// A1 is fixed everywhere (see task-2-report.md, Step 7 note).
const CONCEPT_DIRS = [
  '2.cpp20-coroutines', '3.concurrency', '4.coroutines',
  '5.buffers', '6.streams', '7.testing',
];
const TUTORIAL_FILES = new Set(['quick-start.adoc']);

function walk(dir) {
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(walk(p));
    else if (ent.name.endsWith('.adoc')) out.push(p);
  }
  return out;
}

function pageMode(text) {
  const m = text.match(/^:page-mode:\s*(\S+)/m);
  return m ? m[1] : null;
}

function isConceptOrTutorial(relPath, mode) {
  if (mode) return mode === 'concept' || mode === 'tutorial';
  const top = relPath.split(path.sep)[0];
  return TUTORIAL_FILES.has(relPath) || CONCEPT_DIRS.includes(top);
}

const findings = { A1: [], A6: [], B2: [], D2: [] };
const files = walk(PAGES_DIR);

for (const file of files) {
  const rel = path.relative(PAGES_DIR, file);
  const text = fs.readFileSync(file, 'utf8');
  const mode = pageMode(text);

  if (!mode) findings.A1.push({ file: rel, message: 'no :page-mode: attribute' });

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[source\s*,\s*(cpp|c\+\+)\b[^\]]*\]/i);
    if (!m) continue;
    if (/role=(pseudocode|external)/.test(lines[i])) continue;
    // Find the opening '----' and the first non-blank content line after it.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '----') j++;
    let k = j + 1;
    while (k < lines.length && lines[k].trim() === '') k++;
    const first = (lines[k] || '').trim();
    if (!first.startsWith('include::example$')) {
      findings.B2.push({ file: rel, line: i + 1, message: 'raw code, not include::example$/role=pseudocode/role=external' });
    }
  }

  if (isConceptOrTutorial(rel, mode) && !text.includes('include::example$')) {
    findings.D2.push({ file: rel, message: 'tutorial/concept page has no include::example$' });
  }
}

const navText = fs.readFileSync(NAV_FILE, 'utf8');
const topEntries = navText.split('\n').filter(l => /^\* xref:/.test(l));
const qsIndex = topEntries.findIndex(l => /quick-start/.test(l));
if (qsIndex === -1 || qsIndex > 2) {
  findings.A6.push({ file: 'nav.adoc', message: `quick-start at top-level position ${qsIndex + 1}, must be <= 3` });
}

const summary = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
console.log(JSON.stringify({ summary, findings }, null, 2));
process.exit(0);
