import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CATALOG_CSP, PREVIEW_CSP, RADIX_STYLE_HASHES } from '../scripts/serve.mjs';

// Exact trusted-library source fixtures. Do not replace these with computed, automatically
// authorized library output: a dependency upgrade must review any changed inline styles.
const fixtures = [
  {
    package: '@radix-ui/react-select', version: '2.4.1',
    css: '[data-radix-select-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-select-viewport]::-webkit-scrollbar{display:none}',
  },
  {
    package: '@radix-ui/react-scroll-area', version: '1.4.0',
    css: '[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}',
  },
];

test('catalog authorizes only the two exact static Radix viewport styles', () => {
  const expected = fixtures.map(({ css }) => `sha256-${createHash('sha256').update(css).digest('base64')}`);
  assert.deepEqual(RADIX_STYLE_HASHES, expected);
  const style = CATALOG_CSP.split(';').find(directive => directive.trim().startsWith('style-src '));
  assert.equal(style.trim(), `style-src 'self' ${expected.map(hash => `'${hash}'`).join(' ')}`);
  assert.match(CATALOG_CSP, /script-src 'self';/);
  assert.doesNotMatch(style, /unsafe-inline|unsafe-eval/);
  for (const hash of expected) assert.ok(!PREVIEW_CSP.includes(hash), 'Catalog hashes must not change preview policy');
});

test('reviewed viewport CSS still matches pinned dependencies when UI dependencies are installed', t => {
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) assert.equal(lock.packages[`node_modules/${fixture.package}`]?.version, fixture.version, 'Review CSP when updating the pinned library');
  const paths = fixtures.map(fixture => new URL(`../node_modules/${fixture.package}/dist/index.mjs`, import.meta.url));
  if (paths.some(filename => !fs.existsSync(filename))) { t.skip('Dependency-free engine checkout: install trusted root dependencies to verify library sources'); return; }
  for (const [index, filename] of paths.entries()) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.ok(source.includes(`__html: \`${fixtures[index].css}\``), `${fixtures[index].package} inline style must match the reviewed fixture byte-for-byte`);
  }
});

test('nginx catalog and nonce variant carry the same exact hashes without widening preview/raw CSP', () => {
  const nginx = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');
  const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(match => match[1]);
  const catalog = policies.filter(policy => policy.includes("frame-src 'self'"));
  assert.equal(catalog.length, 2);
  for (const policy of catalog) {
    const style = policy.split(';').find(directive => directive.trim().startsWith('style-src '));
    for (const hash of RADIX_STYLE_HASHES) assert.ok(style.includes(`'${hash}'`));
    assert.doesNotMatch(style, /unsafe-inline|unsafe-eval/);
    assert.match(policy, /script-src 'self';/);
  }
  assert.ok(catalog.some(policy => policy.includes("'nonce-$request_id'")));
  for (const policy of policies.filter(policy => !catalog.includes(policy))) for (const hash of RADIX_STYLE_HASHES) assert.ok(!policy.includes(hash));
});
