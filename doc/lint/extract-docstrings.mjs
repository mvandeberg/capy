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
// The parameter name is dropped, not re-emitted as a label. Emitting it back
// as `name: description` — which this script did until 2026-07 — made every
// `@param`/`@tparam` in the library trip Google.Colons, whose token is
// `(?<!:[^ ]+?):\s[A-Z]`: a colon, a space, a capital. That accounted for 424
// of 444 Colons alerts on this surface, a false-positive class that grows with
// every parameter documented. A parameter name is an identifier, not prose;
// the description is the prose, and the description is what stays linted.
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
// `@li` is stripped like the bare tags, but its item is ALSO re-emitted as its
// own paragraph — see cleanBlock(). Doxygen has no other list-item tag in this
// codebase (`grep -c '@arg' include` -> 0), so `li` is the whole set.
const LIST_ITEM = /^@li\b\s*/;
const INLINE_REFS = /@(ref|p|c)\s+(\S+)/g;

// A Doxygen `@li` item is a sentence, and the extractor used to hand Vale a run
// of them as consecutive lines with the `@li` keyword still in the text. Two
// defects followed, both fixture-confirmed:
//
//   * Vale's sentence segmenter needs `. ` to break and will not break on
//     `\n@li` (`@` is not a capital), so a run of PERIOD-LESS items collapsed
//     into one pseudo-sentence. Five ten-word items produced exactly one
//     Capy.SentenceLength alert whose Match field was literally 'li'; the same
//     five items with terminal periods produced none. C2 was therefore measuring
//     missing Doxygen punctuation, not sentence length.
//   * The surviving `li` keyword spent a phantom word of the 25-word budget, so
//     a list item's real limit was 24. A hand-counted 25-word item alerted.
//
// Each item is now emitted as its own paragraph (blank-line delimited, which is
// what makes it a separate block to asciidoctor and so a separate sentence
// scope) with the keyword removed and continuation lines folded in.
function cleanBlock(raw) {
  // Drop @code ... @endcode samples entirely — not prose.
  const noCode = raw.replace(/@code\b[\s\S]*?@endcode\b/g, '');
  const lines = noCode.split('\n').map((l) => l.trim());
  const prose = [];
  let item = null; // text of the `@li` item currently being accumulated
  const flush = () => { if (item !== null) { prose.push(item, ''); item = null; } };
  const separate = () => { if (prose.length && prose[prose.length - 1] !== '') prose.push(''); };
  for (let line of lines) {
    if (line === '') {
      // The item's own trailing blank line stands in for this one.
      if (item !== null) flush(); else prose.push('');
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      if (item !== null) flush(); else separate();
      item = line.slice(li[0].length).replace(INLINE_REFS, '$2');
      continue;
    }
    // A non-blank, non-tag line under an open item is its continuation.
    if (item !== null) {
      if (!line.startsWith('@')) { item += ` ${line.replace(INLINE_REFS, '$2')}`; continue; }
      flush();
    }
    line = line.replace(NAMED_TAGS, '');
    line = line.replace(BARE_TAGS, '');
    line = line.replace(INLINE_REFS, '$2');
    prose.push(line);
  }
  flush();
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
