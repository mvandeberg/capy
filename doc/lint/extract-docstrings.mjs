#!/usr/bin/env node
//
// extract-docstrings.mjs — pulls Doxygen/MrDocs docstring prose out of
// `include/boost/capy/**/*.hpp` into plain .adoc files so Vale (Style Guide
// Part F) can lint it, not only the Antora `.adoc` pages (Style Guide Part F,
// Task 2 Step 4b). Node built-ins only, no dependencies.
//
// For each header with at least one `/** ... */` block, writes a mirrored
// file under OUT_DIR (default doc/lint/.docstrings/, gitignored — generated
// output, not source) containing just the comment prose: `@code`/`@endcode`
// samples are dropped (not prose, and full of identifiers/punctuation that
// would drown real findings); `@param`/`@tparam`/`@return`/etc. tags have
// their tag keyword (and, for `@param`/`@tparam`, the parameter name) removed
// but keep their description text, since that's the part C.2/C.9/C.10 apply
// to. The file extension is .adoc so it picks up the same `[*.adoc]` section
// of doc/.vale.ini used for the Antora pages — no separate Vale config needed.
//
// Usage: node doc/lint/extract-docstrings.mjs [outDir]
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const INCLUDE_ROOT = path.join(REPO_ROOT, 'include/boost/capy');
const OUT_DIR = path.resolve(REPO_ROOT, process.argv[2] || 'doc/lint/.docstrings');

function walk(dir) {
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(walk(p));
    else if (ent.name.endsWith('.hpp')) out.push(p);
  }
  return out;
}

// Tags whose keyword (and, for param-like tags, the following identifier)
// is stripped but whose trailing description text is kept as prose.
const NAMED_TAGS = /^@(param|tparam)\s+(?:\[[a-z,]+\]\s*)?(\S+)\s*/;
const BARE_TAGS = /^@(returns?|throws?|pre|post|note|warning|brief|see|par)\b\s*/;
const INLINE_REFS = /@(ref|p|c)\s+(\S+)/g;

function cleanBlock(raw) {
  // Drop @code ... @endcode samples entirely — not prose.
  const noCode = raw.replace(/@code\b[\s\S]*?@endcode\b/g, '');
  const lines = noCode.split('\n').map((l) => l.trim());
  const prose = [];
  for (let line of lines) {
    if (line === '') { prose.push(''); continue; }
    line = line.replace(NAMED_TAGS, '$2: ');
    line = line.replace(BARE_TAGS, '');
    line = line.replace(INLINE_REFS, '$2');
    prose.push(line);
  }
  return prose.join('\n').trim();
}

let written = 0;
for (const file of walk(INCLUDE_ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  const blocks = [...text.matchAll(/\/\*\*([\s\S]*?)\*\//g)].map((m) => cleanBlock(m[1])).filter(Boolean);
  if (blocks.length === 0) continue;

  const rel = path.relative(INCLUDE_ROOT, file);
  const outPath = path.join(OUT_DIR, `${rel}.adoc`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, blocks.join('\n\n') + '\n');
  written++;
}

console.log(JSON.stringify({ headersWithDocs: written, outDir: path.relative(REPO_ROOT, OUT_DIR) }, null, 2));
