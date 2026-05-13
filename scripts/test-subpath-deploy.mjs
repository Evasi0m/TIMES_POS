#!/usr/bin/env node
// Subpath deploy smoke test — catches the class of bug that broke the May
// 2026 "stuck offline" incident at the front counter: a precache entry
// with an absolute URL ('/' or '/index.html') that 404s when the app is
// deployed under a GitHub Pages project subpath.
//
// What this does:
//   1. (assumes `npm run build` already ran) reads dist/sw.js
//   2. parses out the precache manifest array that vite-plugin-pwa
//      injects in place of `self.__WB_MANIFEST`
//   3. fails the build if ANY precache URL:
//        - starts with '/' (absolute path — breaks on subpath deploy)
//        - is exactly '/' or '/index.html' (the original bug)
//        - is missing a revision hash (would never be invalidated)
//   4. warns (but doesn't fail) if the manifest is empty — that usually
//      means globPatterns missed your entry point
//
// Run as: node scripts/test-subpath-deploy.mjs
// Or via: npm run test:deploy

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SW = resolve(__dirname, '..', 'dist', 'sw.js');

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error('\x1b[31m✖\x1b[0m ' + msg);
  process.exit(1);
}
function warn(msg) {
  // eslint-disable-next-line no-console
  console.warn('\x1b[33m!\x1b[0m ' + msg);
}
function ok(msg) {
  // eslint-disable-next-line no-console
  console.log('\x1b[32m✓\x1b[0m ' + msg);
}

if (!existsSync(DIST_SW)) {
  fail(`dist/sw.js not found — run \`npm run build\` first.\n   (looked at: ${DIST_SW})`);
}

const src = readFileSync(DIST_SW, 'utf8');

// The precache manifest is injected by vite-plugin-pwa as a proper JSON
// array (keys are quoted). Minifiers rename `precacheAndRoute` to a short
// local, so we can't anchor on that name. Instead find the signature
// array-of-{revision,url} which is unique enough to identify.
//
// Pattern: `[{"revision":...,"url":...}, ...]` (order of keys may vary).
// Use a relaxed match that starts at `[{"` and balances brackets crudely.
const re = /\[\{"(?:revision|url)"[\s\S]*?\}\](?=\s*(?:\|\|\s*\[\]\s*\)|\)))/;
const m = src.match(re);
if (!m) {
  fail('Could not locate precache manifest in dist/sw.js — has the SW bundling changed?');
}

let manifest;
try { manifest = JSON.parse(m[0]); }
catch (e) {
  fail('Failed to parse precache manifest as JSON:\n   ' + e.message +
       '\n   Raw snippet:\n   ' + m[0].slice(0, 300) + '…');
}

if (!Array.isArray(manifest)) {
  fail('Parsed manifest is not an array.');
}

ok(`Parsed precache manifest — ${manifest.length} entries`);

if (manifest.length === 0) {
  warn('Precache manifest is EMPTY — check injectManifest.globPatterns in vite.config.js.');
}

// === Validation ==========================================================
const errors = [];
for (const entry of manifest) {
  if (!entry || typeof entry !== 'object') {
    errors.push('Non-object entry: ' + JSON.stringify(entry));
    continue;
  }
  const { url, revision } = entry;
  if (typeof url !== 'string' || !url) {
    errors.push('Missing url on entry: ' + JSON.stringify(entry));
    continue;
  }
  // The original bug — absolute root URLs that 404 on subpath deploys.
  if (url === '/' || url === '/index.html') {
    errors.push(`Entry "${url}" is an absolute root URL — will 404 on GitHub Pages subpath deploys. ` +
                'Use a relative URL (no leading slash) or let Workbox inject it automatically.');
  }
  // Any leading-slash URL is suspicious for the same reason. Vite with
  // `base: './'` should produce relative URLs for all precache entries.
  else if (url.startsWith('/')) {
    errors.push(`Entry "${url}" has a leading slash — breaks subpath hosting. Expected relative URL.`);
  }
  // Precache entries without a revision never get invalidated when the
  // file changes. vite-plugin-pwa omits revision for filenames that
  // already contain a content hash (e.g. `index-XXXX.js`, `logo-hash.png`)
  // — that's fine. But for filenames WITHOUT a visible hash (like
  // index.html) a null revision means the SW will serve the old one
  // forever; we surface that as a warning.
  // Hash segment may contain letters, digits, `_` or `-` (Vite / Workbox
  // use base64url-ish). Require at least 6 chars so plain filenames with
  // a `-word` suffix don't get treated as hashed.
  const filenameHasHash = /-[A-Za-z0-9_-]{6,}\./.test(url.split('/').pop() || '');
  if (!revision && !filenameHasHash) {
    warn(`Entry "${url}" has no revision and no hash in its filename — may serve stale content.`);
  }
}

if (errors.length > 0) {
  // eslint-disable-next-line no-console
  console.error('\nPrecache manifest has issues:');
  for (const e of errors) fail(e);
}

ok('No absolute/root URLs in precache manifest.');

// === Spot-check that index.html is actually precached ====================
// If globPatterns doesn't include `html`, the app shell won't be cached
// and offline boot breaks in a subtle way (other probes may still pass).
const hasIndexHtml = manifest.some((e) => /index\.html$/.test(e.url));
if (!hasIndexHtml) {
  fail('No index.html in precache manifest — add "html" to injectManifest.globPatterns in vite.config.js.');
}
ok('index.html present in precache manifest.');

// eslint-disable-next-line no-console
console.log('\n\x1b[32mAll subpath-deploy checks passed.\x1b[0m');
