#!/usr/bin/env node
//
// mrdocs-warnings.mjs — reference-surface gate (Style Guide Part F.0,
// "MrDocs-no-warnings"). Node built-ins only, no dependencies.
//
// MrDocs has no standalone CLI package: it runs inside
// @cppalliance/antora-cpp-reference-extension during `npx antora`. Scanning
// the *captured Antora build log* does not work — the extension's runCommand
// helper only forwards MrDocs's stderr to the console; MrDocs prints its
// per-symbol "undocumented"/"missing param doc" findings to stdout, and the
// extension swallows stdout into an internal buffer it never surfaces
// (lib/extension.js, runCommand: `output` is not set for the MrDocs
// invocation, so `ps.stdout` data goes to an array, not the console).
// Verified locally: an Antora build with mrdocs.yml's warning flags on
// produced 0 visible findings in the build log, while invoking the same
// MrDocs binary/config/args directly produced 208.
//
// So this script invokes MrDocs directly, with the same config file and CLI
// arguments the extension uses (mirrored from its debug log), then parses
// combined stdout+stderr itself. It mirrors the extension's own compiler
// preference (clang++/clang over g++/gcc — the extension does this because
// this MrDocs build crashes with a stray GCC-only header path; reproduced
// locally with GCC 16.1.1) so results match what a real Antora build would
// hit if not for the stdout-swallowing bug above.
//
// Non-blocking (Task 2): always exits 0. Findings are JSON on stdout.
//
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(DOC_DIR, '..');
const CONFIG_PATH = path.join(DOC_DIR, 'mrdocs.yml');

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

// Search the Antora reference-collector cache the extension populates
// (getUserCacheDir('antora')/reference-collector/mrdocs/<platform>/<tag>/bin/mrdocs).
function findMrDocsInCache() {
  const bases = [
    process.env.MRDOCS_ROOT,
    path.join(os.homedir(), '.cache/antora/reference-collector/mrdocs'),
  ].filter(Boolean);
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.name === 'mrdocs' || ent.name === 'mrdocs.exe') {
          try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* skip */ }
        }
      }
    }
  }
  return null;
}

const mrdocsExe = findOnPath(['mrdocs', 'mrdocs.exe']) || findMrDocsInCache();
if (!mrdocsExe) {
  emit({
    error: 'mrdocs executable not found (checked PATH and the Antora reference-collector cache). ' +
           'Run the Antora build first (it downloads MrDocs), then re-run this script.',
    summary: { total: 0 },
    findings: [],
  });
}

if (!fs.existsSync(CONFIG_PATH)) {
  emit({ error: `mrdocs.yml not found: ${CONFIG_PATH}`, summary: { total: 0 }, findings: [] });
}

// Mirror CppReferenceExtension.findCXXCompilers(): clang++/clang preferred over g++/gcc.
const cxx = findOnPath(['clang++']) || process.env.CXX_COMPILER || process.env.CXX || findOnPath(['g++']);
const cc = findOnPath(['clang']) || process.env.C_COMPILER || process.env.CC || findOnPath(['gcc']);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrdocs-warnings-'));
const args = [
  `--config=${CONFIG_PATH}`,
  `--output=${outDir}`,
  '--generator=adoc',
  '--multipage=true',
  '--tagfile=reference.tag.xml',
];

const result = spawnSync(mrdocsExe, args, {
  cwd: REPO_ROOT,
  env: { ...process.env, ...(cxx ? { CXX: cxx, CMAKE_CXX_COMPILER: cxx } : {}), ...(cc ? { CC: cc, CMAKE_C_COMPILER: cc } : {}) },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

fs.rmSync(outDir, { recursive: true, force: true });

if (result.error || (result.status !== 0 && result.status !== null)) {
  emit({
    error: `mrdocs exited with status ${result.status}: ${result.error?.message || '(see stderr)'}`,
    stderrTail: (result.stderr || '').slice(-2000),
    summary: { total: 0 },
    findings: [],
  });
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const relIncludePath = (p) => p.replace(/^.*?(include\/boost\/capy\/.*)$/, '$1');
const combined = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
const lines = combined.split('\n');

// MrDocs prints "<path>:<line>:<col>:" then indented "N) <message>" items for
// that location; separately it prints bare "warning: ..." lines (e.g.
// unsupported HTML tags) with no location. CMake's own "CMake Warning" noise
// is excluded — it is a build-system warning, not a reference-surface one.
const LOC_RE = /^(\/\S+\.(?:hpp|cpp|ipp)):(\d+):(\d+):\s*$/;
const ITEM_RE = /^\s*\d+\)\s*(.+)$/;
const BARE_WARNING_RE = /^warning:\s*(.+)$/;

const findings = [];
let currentLoc = null;
for (const line of lines) {
  const loc = line.match(LOC_RE);
  if (loc) {
    currentLoc = { file: relIncludePath(loc[1]), line: Number(loc[2]) };
    continue;
  }
  const item = line.match(ITEM_RE);
  if (item && currentLoc) {
    findings.push({ file: currentLoc.file, line: currentLoc.line, message: item[1].trim() });
    continue;
  }
  const bare = line.match(BARE_WARNING_RE);
  if (bare) findings.push({ file: null, line: null, message: bare[1].trim() });
}

emit({ summary: { total: findings.length }, findings });
