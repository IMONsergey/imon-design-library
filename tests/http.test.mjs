import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';

test('static transport keeps previews sandboxed and raw HTML inert', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'imon-idl-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['raw/test/1.0.0', 'previews/test/1.0.0', 'api', 'downloads']) await mkdir(path.join(root, folder), { recursive: true });
  for (const filename of ['index.html', 'raw/test/1.0.0/index.html', 'previews/test/1.0.0/index.html']) await writeFile(path.join(root, filename), '<h1>Fixture</h1>');
  await writeFile(path.join(root, 'api/catalog.json'), '{"packs":[]}');
  await writeFile(path.join(root, 'downloads/test-1.0.0.zip'), 'fixture');
  await writeFile(path.join(root, 'secret.env'), 'not public');
  await symlink(path.join(root, 'secret.env'), path.join(root, 'raw/test/1.0.0/link.txt'));
  const server = createStaticServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const main = await fetch(origin);
  assert.equal(main.status, 200);
  assert.match(main.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const preview = await fetch(origin + '/previews/test/1.0.0/index.html');
  assert.equal(preview.status, 200);
  const csp = preview.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts;/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
  assert.match(csp, /connect-src 'none'/);
  const raw = await fetch(origin + '/raw/test/1.0.0/index.html');
  assert.match(raw.headers.get('content-type'), /^text\/plain/);
  assert.equal(raw.headers.get('content-disposition'), 'attachment');
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(origin + '/api/catalog.json', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  for (const url of ['/secret.env', '/.git/config', '/raw/test/1.0.0/link.txt', '/raw/%2e%2e%2fsecret.env', '/raw/%00', '/raw/test/1.0.0/', '/api/not-json.txt']) {
    assert.equal((await fetch(origin + url)).status, 404, url);
  }
});
