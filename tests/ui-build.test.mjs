import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildUi, validateUiInputs, validateUiOutputs, thirdPartyNotices, NONCE_PLACEHOLDER } from '../scripts/build-ui.mjs';
import { buildLibrary } from '../scripts/build.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imon-ui-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'site'));
  fs.mkdirSync(path.join(root, 'frontend'));
  fs.writeFileSync(path.join(root, 'site/index.html'), `<!doctype html><html><head><meta name="csp-nonce" content="${NONCE_PLACEHOLDER}"></head><main id="root"></main></html>`);
  fs.writeFileSync(path.join(root, 'site/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'site/theme-init.js'), '/* trusted bootstrap */');
  fs.writeFileSync(path.join(root, 'site/app.js'), '/* legacy bundle must not be copied */');
  fs.writeFileSync(path.join(root, 'site/app.css'), '/* legacy stylesheet must not be copied */');
  fs.writeFileSync(path.join(root, 'frontend/app.jsx'), 'export const App = () => null;');
  return root;
}

const bytes = value => Buffer.from(value);
function fakeCompiler(options) {
  assert.equal(options.bundle, true);
  assert.equal(options.write, false);
  assert.equal(options.sourcemap, false);
  assert.equal(options.splitting, false);
  assert.deepEqual(options.target, ['safari16']);
  assert.equal(options.define['process.env.NODE_ENV'], '"production"');
  return {
    outputFiles: [
      { path: path.join(options.outdir, 'app.js'), contents: bytes('/* compiled catalog */') },
      { path: path.join(options.outdir, 'app.css'), contents: bytes('/* compiled style */') },
      { path: path.join(options.outdir, 'ui-assets/inter-latin-HASH1234.woff2'), contents: bytes('fixture font') },
    ],
    metafile: { inputs: { 'frontend/app.jsx': {} }, outputs: { 'app.js': { imports: [] } } },
  };
}

test('trusted UI compiles to managed cache with exact static output names', async t => {
  const root = fixture(t);
  const result = await buildUi(root, { compiler: fakeCompiler });
  assert.equal(result.output, path.join(root, '.cache/ui'));
  assert.equal(result.files, 7);
  assert.equal(fs.readFileSync(path.join(result.output, 'app.js'), 'utf8'), '/* compiled catalog */');
  assert.equal(fs.statSync(result.output).mode & 0o777, 0o755);
  assert.equal(fs.existsSync(path.join(result.output, 'ui-marker.json')), false);
  const built = buildLibrary(root, { siteRoot: result.output });
  assert.equal(fs.readFileSync(path.join(built.output, 'app.css'), 'utf8'), '/* compiled style */');
  assert.equal(built.health.packVersions, 0);
});

test('compiler failure preserves the previous managed UI and allows retry', async t => {
  const root = fixture(t);
  const first = await buildUi(root, { compiler: fakeCompiler });
  const initial = fs.readFileSync(path.join(first.output, 'app.js'));
  await assert.rejects(buildUi(root, { compiler: () => { throw new Error('fixture compiler failure'); } }), /compiler failure/);
  assert.deepEqual(fs.readFileSync(path.join(first.output, 'app.js')), initial);
  const retry = await buildUi(root, { compiler: fakeCompiler });
  assert.ok(retry.previous);
  assert.deepEqual(fs.readFileSync(path.join(retry.previous, 'app.js')), initial);
});

test('UI output cannot include executable auxiliary routes, maps or non-font assets', async t => {
  const root = fixture(t);
  const valid = await buildUi(root, { compiler: fakeCompiler });
  const files = ['index.html', 'favicon.svg', 'theme-init.js', 'third-party-notices.txt', 'app.js', 'app.css'].map(name => ({ name, data: fs.readFileSync(path.join(valid.output, name)) }));
  for (const name of ['api/catalog.json', 'previews/sample/index.html', 'ui-assets/loader.js', 'ui-assets/icon.svg', '../escape.js', 'app.js.map', 'ui-assets/sub/font.woff2']) {
    assert.throws(() => validateUiOutputs([...files, { name, data: bytes('no') }]), undefined, name);
  }
  assert.throws(() => validateUiOutputs([...files, { name: 'app.js', data: bytes('duplicate') }]), /Duplicate/);
  assert.throws(() => validateUiOutputs(files.filter(file => file.name !== 'app.css')), /Missing/);
  assert.throws(() => validateUiOutputs(files.map(file => file.name === 'index.html' ? { ...file, data: bytes(`${NONCE_PLACEHOLDER}${NONCE_PLACEHOLDER}`) } : file)), /exactly one/);
});

test('pack code, cross-root files, symlinks and external runtime imports stay outside UI', async t => {
  const root = fixture(t);
  const valid = { inputs: { 'frontend/app.jsx': {} }, outputs: { app: { imports: [] } } };
  assert.doesNotThrow(() => validateUiInputs(root, valid));
  for (const name of ['packs/example/1.0.0/component.js', 'site/app.js', '../outside.js', 'https://example.com/app.js']) {
    assert.throws(() => validateUiInputs(root, { ...valid, inputs: { [name]: {} } }), /only use/);
  }
  assert.throws(() => validateUiInputs(root, { ...valid, outputs: { app: { imports: [{ external: true, path: 'https://example.com/react.js' }] } } }), /external runtime/);
  fs.symlinkSync(path.join(root, 'site/app.js'), path.join(root, 'frontend/link.js'));
  assert.throws(() => validateUiInputs(root, { ...valid, inputs: { 'frontend/link.js': {} } }), /Unsafe/);
});

test('unmanaged UI directories and dangling marker links are not overwritten', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '.cache/ui'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache/ui/important.txt'), 'keep');
  await assert.rejects(buildUi(root, { compiler: fakeCompiler }), /unmanaged/);
  assert.equal(fs.readFileSync(path.join(root, '.cache/ui/important.txt'), 'utf8'), 'keep');
  fs.renameSync(path.join(root, '.cache/ui'), path.join(root, '.cache/unmanaged'));
  fs.symlinkSync(path.join(root, 'must-not-be-created.txt'), path.join(root, '.cache/ui-marker.json'));
  await assert.rejects(buildUi(root, { compiler: fakeCompiler }), /Unsafe/);
  assert.equal(fs.existsSync(path.join(root, 'must-not-be-created.txt')), false);
});

test('siteRoot override is restricted and cannot follow a symlinked cache', async t => {
  const root = fixture(t);
  assert.throws(() => buildLibrary(root, { siteRoot: path.join(root, 'frontend') }), /siteRoot/);
  fs.mkdirSync(path.join(root, 'elsewhere/ui'), { recursive: true });
  fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.cache'));
  assert.throws(() => buildLibrary(root, { siteRoot: path.join(root, '.cache/ui') }), /symlinked/);
});

test('dependency notices include full licenses without publishing unrelated npm metadata', t => {
  const root = fixture(t);
  const directory = path.join(root, 'node_modules/sample-runtime');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'sample-runtime', version: '1.2.3', privateInternalMetadata: 'MUST_NOT_PUBLISH' }));
  fs.writeFileSync(path.join(directory, 'LICENSE'), 'Copyright Test Author\nPermission fixture');
  const metadata = { inputs: { 'node_modules/sample-runtime/index.js': {} } };
  const notices = thirdPartyNotices(root, metadata).toString('utf8');
  assert.match(notices, /sample-runtime@1\.2\.3/);
  assert.match(notices, /Copyright Test Author\nPermission fixture/);
  assert.doesNotMatch(notices, /MUST_NOT_PUBLISH/);
  fs.renameSync(path.join(directory, 'LICENSE'), path.join(directory, 'unapproved-license-name'));
  assert.throws(() => thirdPartyNotices(root, metadata), /Missing bundled dependency license/);
});
