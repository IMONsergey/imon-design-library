import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildLibrary } from '../scripts/build.mjs';
import { validateLibrary } from '../scripts/validate.mjs';
import { createDraft } from '../scripts/new-pack.mjs';
import { loadLibrary, validateManifest, safeRelativePath, resolveLocalResource, LIMITS } from '../scripts/lib/manifest.mjs';
import { createZip, crc32 } from '../scripts/lib/zip.mjs';

function fixture(t, { id = 'sample-pack', version = '1.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imon-library-engine-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site/index.html'), '<!doctype html><html lang="ru"><title>Library</title><main>Catalog</main></html>');
  const made = createDraft(root, { id, version, title: 'Sample pack' });
  const manifest = { ...made.manifest, status: 'published', license: { ...made.manifest.license, id: 'LicenseRef-IMON-Proprietary', redistribution: true }, source: { type: 'original', author: 'I’MON' }, review: { by: 'I’MON', date: '2026-11-04' } };
  const save = () => fs.writeFileSync(path.join(made.directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  save();
  return { root, directory: made.directory, manifest, save };
}

function addFile(f, filename, data) {
  f.manifest.files.push(filename);
  const target = path.join(f.directory, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  f.save();
  return target;
}

function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'STORE compression');
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), buffer.readUInt32LE(offset + 14));
    entries.set(name, data);
    offset = dataStart + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central directory follows file data');
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, 'EOCD is present');
  assert.equal(buffer.readUInt16LE(buffer.length - 12), entries.size);
  return entries;
}

test('valid published packs are loaded with verified per-file hashes', (t) => {
  const f = fixture(t);
  const [pack] = loadLibrary(f.root);
  assert.equal(pack.manifest.title, 'Sample pack');
  assert.equal(pack.files.size, 4);
  for (const file of pack.files.values()) assert.equal(file.sha256, createHash('sha256').update(file.data).digest('hex'));
  assert.deepEqual(validateLibrary(f.root), { versions: 1, published: 1, assets: 1, bytes: pack.bytes, privateVersions: 0 });
});

test('new packs start as safe unpublished drafts, never overwrite a version', (t) => {
  const f = fixture(t);
  const made = createDraft(f.root, { id: 'quiet-buttons', title: 'Quiet buttons' });
  assert.equal(made.manifest.status, 'draft');
  assert.equal(made.manifest.license.redistribution, false);
  assert.equal(made.manifest.license.id, 'UNLICENSED');
  assert.equal(made.manifest.review, undefined);
  assert.throws(() => createDraft(f.root, { id: 'quiet-buttons' }), /EEXIST/);
  assert.equal(loadLibrary(f.root).length, 2);
});

for (const id of ['../escape', 'Uppercase', 'space here', 'a/b', '.', 'a--b', 'a'.repeat(81)]) {
  test(`invalid pack id is refused: ${JSON.stringify(id)}`, (t) => {
    const f = fixture(t);
    assert.throws(() => createDraft(f.root, { id }), /slug/);
  });
}

test('manifest requires known fields and matching directory identity', (t) => {
  const f = fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, dangerousOption: true }), /unknown field/);
  assert.throws(() => validateManifest({ ...f.manifest, schemaVersion: 2 }), /schemaVersion/);
  f.manifest.id = 'another-pack'; f.save();
  assert.throws(() => loadLibrary(f.root), /does not match/);
});

for (const version of ['1', '1.0', '01.0.0', '1.0.0-beta.1', '../1.0.0', '1.0.1000000000']) {
  test(`version must be strict semver: ${JSON.stringify(version)}`, (t) => {
    const f = fixture(t);
    assert.throws(() => validateManifest({ ...f.manifest, version }), /version/);
  });
}

test('published packs require rights, review, preview and an asset', (t) => {
  const f = fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, license: { ...f.manifest.license, redistribution: false } }), /redistribution/);
  assert.throws(() => validateManifest({ ...f.manifest, license: { ...f.manifest.license, id: 'UNLICENSED' } }), /rights/);
  const unreviewed = structuredClone(f.manifest); delete unreviewed.review;
  assert.throws(() => validateManifest(unreviewed), /review/);
  const noPreview = structuredClone(f.manifest); delete noPreview.preview;
  assert.throws(() => validateManifest(noPreview), /preview/);
  assert.throws(() => validateManifest({ ...f.manifest, assets: [] }), /at least one asset/);
  assert.throws(() => validateManifest({ ...f.manifest, review: { by: 'I’MON', date: '2026-02-30' } }), /real date/);
});

test('provenance is explicit, credential-free and HTTPS-only', (t) => {
  const f = fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, source: { type: 'third-party', author: 'Author' } }), /source.url/);
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://name:password@example.com', 'https://example.com?token=private']) {
    assert.throws(() => validateManifest({ ...f.manifest, source: { type: 'third-party', author: 'Author', url } }), /HTTPS|authentication/);
  }
  assert.doesNotThrow(() => validateManifest({ ...f.manifest, source: { type: 'third-party', author: 'Author', url: 'https://example.com/project' } }));
});

test('assets, preview and license must reference the allowlist', (t) => {
  const f = fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, preview: 'absent.html' }), /included in files/);
  assert.throws(() => validateManifest({ ...f.manifest, license: { ...f.manifest.license, file: 'absent.txt' } }), /included in files/);
  const asset = { ...f.manifest.assets[0], path: 'absent.css' };
  assert.throws(() => validateManifest({ ...f.manifest, assets: [asset] }), /included in files/);
  assert.throws(() => validateManifest({ ...f.manifest, assets: [f.manifest.assets[0], f.manifest.assets[0]] }), /duplicate/);
  assert.throws(() => validateManifest({ ...f.manifest, files: [...f.manifest.files, 'TOKENS.css'] }), /duplicate/);
});

for (const filename of ['../escape.css', '/etc/passwd', 'a/../../escape.css', 'a//b.css', './file.css', 'a\\b.css', 'https://example.com/a.css', '%2e%2e/file.css', '.env', 'a/.git/config', 'CON.txt', 'credentials.json', 'secret.key', 'a/b.', 'a/file?.css', 'a with spaces.css']) {
  test(`unsafe file path is rejected: ${JSON.stringify(filename)}`, () => assert.throws(() => safeRelativePath(filename)));
}

test('unknown files cannot leak into public source or a built pack', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'unlisted.txt'), 'not approved');
  assert.throws(() => loadLibrary(f.root), /unlisted file/);
});

test('missing files fail validation before a release is created', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.directory, 'tokens.css'));
  assert.throws(() => buildLibrary(f.root), /ENOENT/);
  assert.equal(fs.existsSync(path.join(f.root, 'dist')), false);
});

test('pack symlinks, directory symlinks and hard links are rejected', (t) => {
  const f = fixture(t);
  const css = path.join(f.directory, 'tokens.css');
  const target = path.join(f.root, 'outside.css'); fs.writeFileSync(target, 'body{}');
  fs.unlinkSync(css); fs.symlinkSync(target, css);
  assert.throws(() => loadLibrary(f.root), /symlink/);
  fs.unlinkSync(css); fs.linkSync(target, css);
  assert.throws(() => loadLibrary(f.root), /hard links/);
  fs.unlinkSync(css); fs.writeFileSync(css, 'body{}');
  fs.renameSync(path.join(f.directory, 'preview'), path.join(f.root, 'outside-preview'));
  fs.symlinkSync(path.join(f.root, 'outside-preview'), path.join(f.directory, 'preview'));
  assert.throws(() => loadLibrary(f.root), /symlink/);
});

test('executable files and permissions are rejected', (t) => {
  const f = fixture(t);
  fs.chmodSync(path.join(f.directory, 'tokens.css'), 0o755);
  assert.throws(() => loadLibrary(f.root), /executable permissions/);
  fs.chmodSync(path.join(f.directory, 'tokens.css'), 0o644);
  f.manifest.files.push('install.sh'); f.save();
  assert.throws(() => loadLibrary(f.root), /unsupported or executable file type/);
});

test('asset size and text encoding limits are enforced', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'tokens.css'), Buffer.alloc(LIMITS.fileBytes + 1, 32));
  assert.throws(() => loadLibrary(f.root), /exceeds/);
  fs.writeFileSync(path.join(f.directory, 'tokens.css'), Buffer.from([0xff, 0xfe]));
  assert.throws(() => loadLibrary(f.root), /encoded data|encoding/);
});

test('known secret patterns are refused without echoing the secret', (t) => {
  const f = fixture(t);
  const fake = `ghp_${'a'.repeat(40)}`;
  fs.writeFileSync(path.join(f.directory, 'README.md'), fake);
  assert.throws(() => loadLibrary(f.root), (error) => error.message.includes('possible credential') && !error.message.includes(fake));
});

test('preview resources can traverse up only within their own pack', () => {
  const files = new Set(['tokens.css', 'preview/index.html']);
  assert.equal(resolveLocalResource('../tokens.css?v=1', 'preview/index.html', files), 'tokens.css');
  assert.equal(resolveLocalResource('#section', 'preview/index.html', files), null);
  assert.throws(() => resolveLocalResource('../../other-pack/tokens.css', 'preview/index.html', files));
  assert.throws(() => resolveLocalResource('/raw/other-pack/1.0.0/tokens.css', 'preview/index.html', files));
  assert.throws(() => resolveLocalResource('../missing.css', 'preview/index.html', files), /unlisted/);
  assert.throws(() => resolveLocalResource('https&#58;//example.com/x', 'preview/index.html', files), /external/);
  assert.throws(() => resolveLocalResource('javascript:alert(1)', 'preview/index.html', files), /external/);
  assert.throws(() => resolveLocalResource('//example.com/x', 'preview/index.html', files), /external/);
  assert.throws(() => resolveLocalResource('%2e%2e/tokens.css', 'preview/index.html', files), /encoded/);
  assert.equal(resolveLocalResource('data:image/png;base64,aGVsbG8=', 'preview/index.html', files), null);
  assert.throws(() => resolveLocalResource('data:text/html;base64,aGVsbG8=', 'preview/index.html', files), /external/);
});

test('external HTML and CSS resources are refused', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'tokens.css'), 'body { background: url(https://example.com/pixel.png); }');
  assert.throws(() => loadLibrary(f.root), /external/);
  fs.writeFileSync(path.join(f.directory, 'tokens.css'), '@import "https://example.com/a.css";');
  assert.throws(() => loadLibrary(f.root), /external/);
  fs.writeFileSync(path.join(f.directory, 'tokens.css'), 'body {}');
  fs.writeFileSync(path.join(f.directory, 'preview/index.html'), '<img src="https://example.com/pixel.png">');
  assert.throws(() => loadLibrary(f.root), /external/);
});

test('unsupported embedded pages and forms fail closed', (t) => {
  const f = fixture(t);
  for (const html of ['<iframe src="../README.md"></iframe>', '<object data="../README.md"></object>', '<form></form>', '<base href="../">', '<meta http-equiv="refresh" content="0;https://example.com">', '<meta http-equiv="&#114;efresh" content="0;https://example.com">']) {
    fs.writeFileSync(path.join(f.directory, 'preview/index.html'), html);
    assert.throws(() => loadLibrary(f.root), /not allowed/);
  }
});

test('scripts require an explicit reviewed manifest flag; the build never executes them', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'preview/index.html'), '<script>throw new Error("must not execute")</script>');
  assert.throws(() => loadLibrary(f.root), /scripts=true/);
  f.manifest.scripts = true; f.save();
  assert.doesNotThrow(() => buildLibrary(f.root));
  f.manifest.scripts = false; f.save();
  fs.writeFileSync(path.join(f.directory, 'preview/index.html'), '<button onclick="alert(1)">Click</button>');
  assert.throws(() => loadLibrary(f.root), /scripts=true/);
});

test('SVG active content and entities are rejected', (t) => {
  const f = fixture(t);
  addFile(f, 'icon.svg', '<svg><path d="M0 0h10v10z"/></svg>');
  assert.doesNotThrow(() => loadLibrary(f.root));
  fs.writeFileSync(path.join(f.directory, 'icon.svg'), '<svg><foreignObject><div>HTML</div></foreignObject></svg>');
  assert.throws(() => loadLibrary(f.root), /foreignObject/);
  fs.writeFileSync(path.join(f.directory, 'icon.svg'), '<!DOCTYPE svg><svg/>');
  assert.throws(() => loadLibrary(f.root), /DTD/);
});

test('only public published versions appear anywhere in the build output', (t) => {
  const f = fixture(t);
  const draft = createDraft(f.root, { id: 'draft-pack' });
  const privatePack = createDraft(f.root, { id: 'private-pack' });
  const privateManifest = { ...privatePack.manifest, visibility: 'private' };
  fs.writeFileSync(path.join(privatePack.directory, 'manifest.json'), JSON.stringify(privateManifest));
  fs.mkdirSync(path.join(f.root, 'inbox'));
  fs.writeFileSync(path.join(f.root, 'inbox/private.txt'), 'private material is outside packs');
  const result = buildLibrary(f.root, { revision: 'abcdef0123456789' });
  assert.equal(result.catalog.packs.length, 1);
  assert.equal(result.excluded, 2);
  assert.equal(result.health.revision, 'abcdef0123456789');
  assert.equal(fs.statSync(result.output).mode & 0o777, 0o755, 'nginx can traverse the public release root');
  assert.equal(fs.existsSync(path.join(result.output, 'raw', draft.manifest.id)), false);
  assert.equal(fs.existsSync(path.join(result.output, 'raw', privateManifest.id)), false);
  assert.equal(fs.existsSync(path.join(result.output, 'inbox')), false);
  assert.equal(fs.existsSync(path.join(result.output, 'api/schema.json')), true);
  assert.equal(result.catalog.packs[0].files.length, f.manifest.files.length);
  const exact = JSON.parse(fs.readFileSync(path.join(result.output, result.catalog.packs[0].manifestUrl.slice(1))));
  assert.deepEqual(exact, result.catalog.packs[0]);
});

test('built raw/preview resources and deterministic ZIP are byte-identical to source', (t) => {
  const f = fixture(t);
  addFile(f, 'image.png', Buffer.from([0, 1, 2, 255]));
  const first = buildLibrary(f.root);
  const item = first.catalog.packs[0];
  const zip = fs.readFileSync(path.join(first.output, item.downloadUrl.slice(1)));
  const contents = zipEntries(zip);
  assert.equal(contents.size, f.manifest.files.length + 1);
  for (const file of item.files) {
    const source = fs.readFileSync(path.join(f.directory, file.path));
    assert.deepEqual(fs.readFileSync(path.join(first.output, file.url.slice(1))), source);
    assert.deepEqual(fs.readFileSync(path.join(first.output, 'previews', item.id, item.version, file.path)), source);
    assert.deepEqual(contents.get(file.path), source);
  }
  assert.deepEqual(contents.get('manifest.json'), fs.readFileSync(path.join(f.directory, 'manifest.json')));
  assert.equal(zip.length, item.downloadSize);
  assert.equal(createHash('sha256').update(zip).digest('hex'), item.downloadSha256);
  const second = buildLibrary(f.root);
  assert.deepEqual(fs.readFileSync(path.join(second.output, item.downloadUrl.slice(1))), zip);
  assert.ok(second.previous);
  assert.equal(fs.existsSync(path.join(second.previous, 'api/catalog.json')), true);
});

test('failed validation preserves the previously published build', (t) => {
  const f = fixture(t);
  const result = buildLibrary(f.root);
  const previous = fs.readFileSync(path.join(result.output, 'api/catalog.json'));
  f.manifest.license.redistribution = false; f.save();
  assert.throws(() => buildLibrary(f.root), /redistribution/);
  assert.deepEqual(fs.readFileSync(path.join(result.output, 'api/catalog.json')), previous);
});

test('unmanaged or symlinked output directories are never overwritten', (t) => {
  const f = fixture(t);
  const output = path.join(f.root, 'dist');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'important.txt'), 'keep me');
  assert.throws(() => buildLibrary(f.root), /unmanaged/);
  assert.equal(fs.readFileSync(path.join(output, 'important.txt'), 'utf8'), 'keep me');
  fs.renameSync(output, path.join(f.root, 'outside'));
  fs.symlinkSync(path.join(f.root, 'outside'), output);
  assert.throws(() => buildLibrary(f.root), /real directory/);
});

test('site files cannot replace generated routes or be symlinks', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'site/api'));
  fs.writeFileSync(path.join(f.root, 'site/api/catalog.json'), '{}');
  assert.throws(() => buildLibrary(f.root), /reserved/);
  fs.unlinkSync(path.join(f.root, 'site/api/catalog.json'));
  fs.rmdirSync(path.join(f.root, 'site/api'));
  fs.symlinkSync(path.join(f.directory, 'tokens.css'), path.join(f.root, 'site/style.css'));
  assert.throws(() => buildLibrary(f.root), /symlink/);
});

test('ZIP entries have safe names, stable order and standard CRC32', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const a = { name: 'a.txt', data: Buffer.from('a') };
  const b = { name: 'b.txt', data: Buffer.from('b') };
  assert.deepEqual(createZip([a, b]), createZip([b, a]));
  assert.throws(() => createZip([{ name: '../escape.txt', data: Buffer.from('bad') }]));
  assert.throws(() => createZip([a, { ...a, name: 'A.txt' }]), /Duplicate/);
});

test('empty libraries are valid and build an honest zero-pack catalog', (t) => {
  const f = fixture(t);
  fs.renameSync(path.join(f.root, 'packs'), path.join(f.root, 'quarantined-packs'));
  const result = buildLibrary(f.root);
  assert.equal(result.catalog.packs.length, 0);
  assert.equal(result.health.packVersions, 0);
  assert.equal(result.health.assets, 0);
  assert.deepEqual(validateLibrary(f.root), { versions: 0, published: 0, assets: 0, bytes: 0, privateVersions: 0 });
});

test('removing every pack produces a clean release without stale raw, preview, manifest or ZIP files', (t) => {
  const f = fixture(t);
  const before = buildLibrary(f.root);
  const pack = before.catalog.packs[0];
  assert.equal(fs.existsSync(path.join(before.output, pack.downloadUrl.slice(1))), true);
  fs.renameSync(path.join(f.root, 'packs'), path.join(f.root, 'retired-fixtures'));
  fs.mkdirSync(path.join(f.root, 'packs'));
  const after = buildLibrary(f.root);
  assert.deepEqual(after.catalog, { schemaVersion: 1, packs: [] });
  assert.equal(after.health.packVersions, 0);
  assert.equal(after.health.assets, 0);
  for (const folder of ['raw', 'previews', 'downloads', 'api/packs']) {
    assert.equal(fs.existsSync(path.join(after.output, folder)), false, `${folder} is absent from the new public release`);
  }
  assert.ok(after.previous, 'the previous release is retained outside the public output');
  assert.equal(fs.existsSync(path.join(after.previous, pack.downloadUrl.slice(1))), true);
});
