import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePack } from '../frontend/catalog.mjs';
import { buildLibrary } from '../scripts/build.mjs';
import { createCatalogFixture } from './helpers/catalog-fixture.mjs';

const ORIGIN = 'https://css.imon.world';
const HASH = 'a'.repeat(64);

function validPack() {
  const id = 'sample-pack', version = '1.0.0';
  return {
    schemaVersion: 1,
    id, version, title: 'Sample pack', summary: 'Standalone styles and usage notes.',
    category: 'components', tags: ['css'], scripts: false,
    license: { id: 'LicenseRef-IMON-Proprietary', file: 'LICENSE.txt', redistribution: true },
    source: { type: 'original', author: 'I’MON' },
    review: { by: 'Automated fixture check', date: '2026-11-04' },
    previewUrl: `/previews/${id}/${version}/preview/index.html`,
    downloadUrl: `/downloads/${id}-${version}.zip`, downloadSize: 1024, downloadSha256: HASH,
    manifestUrl: `/api/packs/${id}/${version}.json`,
    files: ['LICENSE.txt', 'preview/index.html', 'styles.css'].map(filename => ({ path: filename, url: `/raw/${id}/${version}/${filename}`, size: 64, sha256: HASH })),
    assets: [{ id: 'styles', title: 'Styles', type: 'stylesheet', path: 'styles.css', description: 'Scoped CSS.', usage: 'Use only inside .sample-pack.\nDo not mix with other packs.' }],
  };
}

function rejects(mutate, expected = /Invalid catalog:/) {
  const pack = validPack();
  mutate(pack);
  assert.throws(() => validatePack(pack, ORIGIN), expected);
}

test('catalog boundary is DOM-free, returns the same object and does not mutate it', () => {
  const pack = validPack();
  const original = structuredClone(pack);
  assert.strictEqual(validatePack(pack, ORIGIN), pack);
  assert.strictEqual(validatePack(pack, 'http://127.0.0.1:4173'), pack);
  assert.deepEqual(pack, original);
});

test('new folder, autoplay and per-asset URLs validate without changing legacy records', () => {
  const legacy = validPack();
  assert.equal(Object.hasOwn(legacy, 'autoplay'), false);
  assert.equal(Object.hasOwn(legacy.assets[0], 'url'), false);
  assert.doesNotThrow(() => validatePack(legacy, ORIGIN));
  const pack = validPack();
  pack.folder = { id: 'visual', title: 'Visual' };
  pack.scripts = true; pack.autoplay = true;
  pack.assets[0].url = '/raw/sample-pack/1.0.0/styles.css';
  pack.assets[0].previewUrl = '/previews/sample-pack/1.0.0/preview/index.html';
  const before = structuredClone(pack);
  assert.strictEqual(validatePack(pack, ORIGIN), pack);
  assert.deepEqual(pack, before);
});

test('folder metadata rejects malformed objects, identities, titles and extra fields', () => {
  for (const value of [null, [], 'visual', {}, { id: 'visual' }, { title: 'Visual' }, { id: '../visual', title: 'Visual' }, { id: 'Visual', title: 'Visual' }, { id: 'a'.repeat(81), title: 'Visual' }, { id: 'visual', title: '' }, { id: 'visual', title: ' Visual' }, { id: 'visual', title: 'a'.repeat(121) }, { id: 'visual', title: 'Bad\u0000title' }, { id: 'visual', title: 'Visual', url: 'https://example.com' }]) {
    rejects(pack => { pack.folder = value; }, /folder/);
  }
});

test('autoplay cannot be truthy metadata or bypass script/review requirements', () => {
  for (const value of [null, 'true', 'false', 0, 1, {}, []]) rejects(pack => { pack.autoplay = value; }, /autoplay/);
  rejects(pack => { pack.autoplay = true; }, /autoplay.*scripts/);
  rejects(pack => { pack.autoplay = true; pack.scripts = true; delete pack.review; }, /autoplay.*review/);
  const manual = validPack(); manual.autoplay = false; delete manual.review;
  assert.doesNotThrow(() => validatePack(manual, ORIGIN));
});

test('catalog boundary accepts real builder output from an isolated temporary fixture', t => {
  const { catalog, cleanup } = createCatalogFixture();
  t.after(cleanup);
  assert.deepEqual(catalog.packs.map(pack => pack.id), ['boundary-fixture']);
  for (const pack of catalog.packs) assert.strictEqual(validatePack(pack, ORIGIN), pack);
});

test('catalog builder supports a genuinely empty library without publishing fixtures', t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imon-empty-catalog-test-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporaryRoot, 'site'));
  fs.writeFileSync(path.join(temporaryRoot, 'site/index.html'), '<!doctype html><title>Empty catalog fixture</title>');
  const { catalog, health } = buildLibrary(temporaryRoot);
  assert.deepEqual(catalog, { schemaVersion: 1, packs: [] });
  assert.equal(health.packVersions, 0);
  assert.equal(health.assets, 0);
});

test('only an explicit canonical HTTP(S) origin is accepted', () => {
  for (const origin of [undefined, null, {}, '', 'null', 'file:///tmp/catalog', 'javascript:alert(1)', '//css.imon.world', 'https://css.imon.world/path', 'https://user:password@css.imon.world', 'https://css.imon.world?x=1', 'https://css.imon.world#x']) {
    assert.throws(() => validatePack(validPack(), origin), /origin/, String(origin));
  }
});

test('malformed top-level records and required display values are rejected', () => {
  for (const value of [null, undefined, [], false, 'pack', 42]) assert.throws(() => validatePack(value, ORIGIN), /pack/);
  for (const field of ['title', 'summary']) for (const value of [undefined, null, {}, [], 2, false, '']) rejects(pack => { pack[field] = value; }, new RegExp(field));
  for (const id of [123, ['sample-pack'], '../other', 'Upper', 'a'.repeat(81)]) rejects(pack => { pack.id = id; }, /id/);
  for (const version of [1, ['1.0.0'], '1.0', '01.0.0', '1.0.0-beta', '1.0.1000000000']) rejects(pack => { pack.version = version; }, /version/);
  rejects(pack => { pack.category = {}; }, /category/);
  rejects(pack => { pack.schemaVersion = 2; }, /schemaVersion/);
});

test('scripts must be a boolean and download size must be a nonnegative safe integer', () => {
  for (const value of [undefined, null, 'false', 0, 1, {}, []]) rejects(pack => { pack.scripts = value; }, /scripts/);
  for (const value of [undefined, null, '1024', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) rejects(pack => { pack.downloadSize = value; }, /downloadSize/);
  const pack = validPack();
  pack.scripts = true; pack.downloadSize = 0;
  assert.strictEqual(validatePack(pack, ORIGIN), pack);
});

test('optional provenance can be absent, but its displayed values cannot be objects', () => {
  const absent = validPack(); delete absent.source; delete absent.review;
  assert.doesNotThrow(() => validatePack(absent, ORIGIN));
  const minimal = validPack(); minimal.source = {};
  assert.doesNotThrow(() => validatePack(minimal, ORIGIN));
  for (const field of ['source', 'review', 'license']) for (const value of [null, [], 'text']) rejects(pack => { pack[field] = value; }, new RegExp(field));
  for (const value of [{}, [], 42, false, null]) {
    rejects(pack => { pack.source.author = value; }, /source.author/);
    rejects(pack => { pack.source.url = value; }, /source.url/);
    rejects(pack => { pack.review.by = value; }, /review.by/);
    rejects(pack => { pack.review.date = value; }, /review.date/);
    rejects(pack => { pack.license.id = value; }, /license.id/);
  }
  rejects(pack => { pack.review = {}; }, /review.by/);
});

test('source links allow HTTPS provenance, never executable schemes or credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://example.com/source', '//example.com/source', 'https://name:secret@example.com/source', 'invalid']) rejects(pack => { pack.source.url = value; }, /source.url/);
  const pack = validPack(); pack.source.url = 'https://example.com/source?version=1#license';
  assert.doesNotThrow(() => validatePack(pack, ORIGIN));
});

test('plain text is kept as text, including markup-shaped strings and multiline usage', () => {
  const pack = validPack();
  pack.title = '<img src=x onerror=alert(1)>';
  pack.source.author = '<b>Author</b>';
  pack.assets[0].usage = '<button class="sample-pack">Button</button>\nUse only this scope.';
  assert.strictEqual(validatePack(pack, ORIGIN), pack);
  rejects(value => { value.title = 'Hidden\u0000value'; }, /title/);
});

test('download and manifest paths must match the exact generated pack URL', () => {
  for (const field of ['downloadUrl', 'manifestUrl']) {
    for (const mutate of [value => `${value}-wrong`, value => `${value}/extra`, value => `${value}?x=1`, value => `${value}#fragment`, value => `${ORIGIN}${value}`, value => `https://example.com${value}`, value => `//example.com${value}`, value => value.replace('sample-pack', 'other-pack'), value => value.replace('1.0.0', '2.0.0')]) {
      rejects(pack => { pack[field] = mutate(pack[field]); }, new RegExp(field));
    }
  }
});

test('raw URLs must correspond to their declared file path, not merely share a prefix', () => {
  for (const value of ['/raw/sample-pack/1.0.0/styles.css-wrong', '/raw/sample-pack/1.0.0/LICENSE.txt', '/raw/other-pack/1.0.0/styles.css', '/raw/sample-pack/2.0.0/styles.css', '/raw/sample-pack/1.0.0/../styles.css', '/raw/sample-pack/1.0.0/%2e%2e/styles.css', 'https://example.com/styles.css', '//example.com/styles.css', '/raw/sample-pack/1.0.0/styles.css?x=1', '/raw/sample-pack/1.0.0/styles.css#x']) {
    rejects(pack => { pack.files[2].url = value; }, /file.url/);
  }
});

test('individual asset download URLs must be the exact raw URL of the declared asset path', () => {
  for (const value of [null, {}, 1, '/raw/sample-pack/1.0.0/styles.css-wrong', '/raw/sample-pack/1.0.0/LICENSE.txt', '/raw/other-pack/1.0.0/styles.css', '/raw/sample-pack/2.0.0/styles.css', '/raw/sample-pack/1.0.0/../styles.css', '/raw/sample-pack/1.0.0/%2e%2e/styles.css', 'https://css.imon.world/raw/sample-pack/1.0.0/styles.css', 'https://example.com/styles.css', '//example.com/styles.css', '/raw/sample-pack/1.0.0/styles.css?x=1', '/raw/sample-pack/1.0.0/styles.css#x']) {
    rejects(pack => { pack.assets[0].url = value; }, /asset.url/);
  }
});

test('unsafe declared paths fail even when the raw URL is changed to match them', () => {
  for (const filename of ['../escape.css', '/root.css', './styles.css', 'nested//styles.css', 'nested/../styles.css', 'nested\\styles.css', '%2e%2e/styles.css', 'styles.css?x=1', 'styles.css#x', 'https://example.com/styles.css', '.env', 'nested/.secret', 'with space.css', 'trailing.', 'a/'.repeat(12) + 'styles.css', 'a'.repeat(241)]) {
    rejects(pack => { pack.files[2].path = filename; pack.files[2].url = `/raw/sample-pack/1.0.0/${filename}`; }, /file.path/);
  }
});

test('preview must be an allowlisted HTML file from exactly this pack and version', () => {
  for (const value of ['/previews/sample-pack/1.0.0/missing.html', '/previews/sample-pack/1.0.0/styles.css', '/previews/other-pack/1.0.0/preview/index.html', '/previews/sample-pack/2.0.0/preview/index.html', '/previews/sample-pack/1.0.0/../index.html', '/previews/sample-pack/1.0.0/%2e%2e/index.html', '/previews/sample-pack/1.0.0/preview/index.html?x=1', '/previews/sample-pack/1.0.0/preview/index.html#x', 'https://example.com/index.html', '//example.com/index.html', null, {}]) {
    rejects(pack => { pack.previewUrl = value; }, /previewUrl/);
  }
});

test('individual preview URLs stay within this exact pack version and its listed HTML files', () => {
  for (const value of [null, {}, 1, 'preview/index.html', '/previews/sample-pack/1.0.0/missing.html', '/previews/sample-pack/1.0.0/styles.css', '/previews/other-pack/1.0.0/preview/index.html', '/previews/sample-pack/2.0.0/preview/index.html', '/previews/sample-pack/1.0.0/../index.html', '/previews/sample-pack/1.0.0/%2e%2e/index.html', '/previews/sample-pack/1.0.0/preview/index.html?x=1', '/previews/sample-pack/1.0.0/preview/index.html#x', 'https://css.imon.world/previews/sample-pack/1.0.0/preview/index.html', 'https://example.com/index.html', '//example.com/index.html']) {
    rejects(pack => { pack.assets[0].previewUrl = value; }, /asset.previewUrl/);
  }
  const pack = validPack();
  pack.files.push({ path: 'preview/asset.htm', url: '/raw/sample-pack/1.0.0/preview/asset.htm', size: 12, sha256: HASH });
  pack.assets[0].previewUrl = '/previews/sample-pack/1.0.0/preview/asset.htm';
  assert.doesNotThrow(() => validatePack(pack, ORIGIN));
});

test('file list, sizes, hashes and path identities are validated before rendering', () => {
  for (const value of [undefined, null, {}, [], [null], [42]]) rejects(pack => { pack.files = value; }, /file/);
  for (const value of ['1', -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) rejects(pack => { pack.files[0].size = value; }, /file.size/);
  for (const value of [null, ['a'.repeat(64)], 'a'.repeat(63), 'Z'.repeat(64)]) rejects(pack => { pack.files[0].sha256 = value; }, /file.sha256/);
  rejects(pack => { pack.files.push({ ...pack.files[2] }); }, /duplicate/);
  rejects(pack => { pack.files.push({ ...pack.files[2], path: 'STYLES.css', url: '/raw/sample-pack/1.0.0/STYLES.css' }); }, /duplicate/);
  rejects(pack => { pack.license.file = 'missing.txt'; }, /license.file/);
  rejects(pack => { pack.downloadSha256 = ['a'.repeat(64)]; }, /downloadSha256/);
});

test('asset display values and file references are validated', () => {
  for (const value of [null, {}, [], [null]]) rejects(pack => { pack.assets = value; }, /asset/);
  for (const field of ['title', 'description', 'usage']) for (const value of [null, {}, [], 1, false]) rejects(pack => { pack.assets[0][field] = value; }, new RegExp(`asset.${field}`));
  rejects(pack => { pack.assets[0].path = 'missing.css'; }, /asset.path/);
  rejects(pack => { pack.assets[0].path = '../styles.css'; }, /asset.path/);
  rejects(pack => { pack.assets[0].id = ['styles']; }, /asset.id/);
  rejects(pack => { pack.assets.push({ ...pack.assets[0] }); }, /duplicate/);
});

test('tags and bounded arrays reject malformed or oversized data', () => {
  for (const value of [null, {}, [null], [{}], [false], ['a'.repeat(49)], Array(21).fill('tag')]) rejects(pack => { pack.tags = value; }, /tags/);
  rejects(pack => { pack.files = Array(257).fill(pack.files[0]); }, /files/);
  rejects(pack => { pack.assets = Array(257).fill(pack.assets[0]); }, /assets/);
});
