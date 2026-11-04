import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../scripts/lib/manifest.mjs';

const root = new URL('../', import.meta.url);
const directory = new URL('../packs/visual-weblg/1.0.0/', import.meta.url);

test('Visual WebLG preserves the owner-provided source byte for byte', () => {
  const source = fs.readFileSync(new URL('diamond-cut-study-restored.html', directory));
  assert.equal(source.length, 27113);
  assert.equal(createHash('sha256').update(source).digest('hex'), '59ceac923be98dd8cf158fab14b9b221f61fea045f75463eaddb0ffcc89ea402');
  const preview = fs.readFileSync(new URL('preview/index.html', directory), 'utf8');
  assert.equal(preview.split(source.toString('utf8')).length, 2, 'The preview contains one unchanged copy of the source');
  assert.match(preview, /^<!doctype html>/);
  assert.match(preview, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('Visual WebLG is one independently namespaced, manually launched asset', () => {
  const packs = loadLibrary(root.pathname);
  const pack = packs.find(item => item.manifest.id === 'visual-weblg' && item.manifest.version === '1.0.0');
  assert.ok(pack);
  assert.equal(pack.manifest.title, 'Visual WebLG');
  assert.equal(pack.manifest.scripts, true);
  assert.equal(pack.manifest.assets.length, 1);
  assert.equal(pack.manifest.assets[0].path, 'diamond-cut-study-restored.html');
  assert.equal(pack.manifest.source.author, 'Сергей Отческов / I’MON');
  assert.equal(pack.manifest.license.id, 'LicenseRef-IMON-Proprietary');
  assert.equal(pack.files.size, 4);
});
