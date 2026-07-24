#!/usr/bin/env node
//
// run-a11y.mjs — accessibility contrast gate (Style Guide rule E4 / Part F.0
// "a11y contrast" warning). Node built-ins + the pa11y-ci devDependency
// (doc/package.json) + `python3` to serve the built site (present on
// ubuntu-latest CI runners and used here instead of a hand-rolled static
// server — a from-scratch Node server produced silent per-page navigation
// errors from pa11y/axe instead of real findings when this was tried).
//
// Requires the Antora site to already be built (doc/build/site).
//
// Usage: node doc/lint/run-a11y.mjs
// Non-blocking (Task 2): always exits 0. Findings are JSON on stdout.
//
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(SCRIPT_DIR, '..');

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const siteDir = path.join(DOC_DIR, 'build/site');
if (!fs.existsSync(siteDir)) {
  emit({ error: 'doc/build/site not built — run the Antora build first', summary: { total: 0 }, findings: [] });
}

const configPath = path.join(DOC_DIR, '.pa11yci.json');
if (!fs.existsSync(configPath)) {
  emit({ error: `pa11y config not found: ${configPath}`, summary: { total: 0 }, findings: [] });
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const firstUrl = (config.urls || [])[0];
const portMatch = firstUrl && firstUrl.match(/:(\d+)\b/);
const PORT = portMatch ? Number(portMatch[1]) : 8088;

function waitForPort(port, deadlineMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > deadlineMs) reject(new Error(`nothing listening on :${port}`));
        else setTimeout(attempt, 100);
      });
    })();
  });
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', siteDir], { stdio: 'ignore' });
let payload;
try {
  await waitForPort(PORT, 5000);
  const bin = path.join(DOC_DIR, 'node_modules/.bin/pa11y-ci');
  const r = spawnSync(bin, ['--config', configPath, '--json'], { cwd: DOC_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let parsed;
  try { parsed = JSON.parse(r.stdout || '{}'); } catch {
    payload = { error: 'pa11y-ci did not return JSON (Chromium unavailable?)', stderrTail: (r.stderr || '').slice(-2000), summary: { total: 0 }, findings: [] };
  }
  if (!payload) {
    const findings = [];
    for (const [url, items] of Object.entries(parsed.results || {})) {
      const publicUrl = url.replace(/^https?:\/\/[^/]+/, '');
      for (const it of items) findings.push({ url: publicUrl, code: it.code, type: it.type, selector: it.selector, message: it.message });
    }
    payload = { summary: { total: findings.length, contrast: findings.filter((f) => f.code === 'color-contrast').length }, findings };
  }
} catch (err) {
  payload = { error: `could not reach local server: ${err.message}`, summary: { total: 0 }, findings: [] };
} finally {
  server.kill();
}
emit(payload);
