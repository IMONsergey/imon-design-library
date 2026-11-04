// Local-only, disposable browser QA. Never targets production or a user profile.
// The fixture is generated in mkdtemp; only its test metadata/source bytes remain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer, PREVIEW_CSP } from '../scripts/serve.mjs';
import { validatePack } from '../frontend/catalog.mjs';
import { createCatalogFixture } from './helpers/catalog-fixture.mjs';
import { assertCatalogControls, assertStableLinks, assertLatestResourceRequests, verifyLatestRouting } from './browser-latest.mjs';

assert.ok(!process.env.LIBRARY_URL, 'Unset LIBRARY_URL: edge QA serves only the local UI build');
const fixture = createCatalogFixture({ id: 'qa-edge-boundary', version: '1.0.0' });
let sample;
const rawBodies = new Map();
try {
  sample = structuredClone(fixture.catalog.packs[0]);
  for (const file of sample.files) rawBodies.set(file.path, fs.readFileSync(path.join(fixture.output, file.url.slice(1))));
} finally { fixture.cleanup(); }
assert.ok(sample, 'A disposable fixture supplies valid generated metadata');
function scriptPack(version, autoplay) {
  const pack = structuredClone(sample);
  const oldPrefix = `/previews/${pack.id}/${pack.version}/`;
  const previewPath = pack.previewUrl.slice(oldPrefix.length);
  assert.ok(pack.previewUrl.startsWith(oldPrefix) && previewPath);
  pack.id = 'qa-script-pack'; pack.version = version; pack.scripts = true;
  pack.folder = { id: 'visual', title: 'Visual' };
  if (autoplay) pack.autoplay = true; else delete pack.autoplay;
  pack.previewUrl = `/previews/${pack.id}/${version}/${previewPath}`;
  pack.downloadUrl = `/downloads/${pack.id}-${version}.zip`;
  pack.manifestUrl = `/api/packs/${pack.id}/${version}.json`;
  pack.files = pack.files.map(file => ({ ...file, url: `/raw/${pack.id}/${version}/${file.path}` }));
  pack.assets = pack.assets.map((asset, index) => ({
    ...asset,
    url: `/raw/${pack.id}/${version}/${asset.path}`,
    ...(index === 0 ? { previewUrl: pack.previewUrl } : {}),
  }));
  pack.assets.push({ ...pack.assets[0], id: autoplay ? 'new-only' : 'retired-only', title: autoplay ? 'Новый тестовый ассет' : 'Архивный тестовый ассет', path: 'README.md', url: `/raw/${pack.id}/${version}/README.md` });
  delete pack.assets.at(-1).previewUrl;
  return pack;
}
const versions = [scriptPack('1.0.0', false), scriptPack('2.0.0', true)];
let catalog = { schemaVersion: 1, packs: versions }, catalogRequests = 0;
for (const pack of versions) validatePack(pack, 'http://127.0.0.1');
const previewRequests = [], previewResponses = [], resourceRequests = [], errors = [], consoleErrors = [], cspErrors = [], external = [], checks = [];
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const executablePath = { chromium: process.env.CHROME_BIN, firefox: process.env.FIREFOX_BIN, webkit: process.env.WEBKIT_BIN }[engine];
const server = createStaticServer(path.resolve('dist'));
let browser, page;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.exposeBinding('__imonEdgeCsp', ({ frame }, item) => cspErrors.push({ frame: frame.url(), ...item }));
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => { globalThis.__imonEdgeCsp({ directive: event.effectiveDirective, blocked: event.blockedURI }).catch(() => {}); }));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { external.push(url.href); return route.abort(); }
    if (url.pathname === '/api/catalog.json') { catalogRequests++; return route.fulfill({ json: catalog }); }
    const raw = url.pathname.match(/^\/raw\/qa-script-pack\/(1\.0\.0|2\.0\.0)\/(.+)$/);
    if (raw && rawBodies.has(raw[2])) {
      const file = versions.find(pack => pack.version === raw[1]).files.find(item => item.path === raw[2]);
      const body = rawBodies.get(raw[2]);
      assert.equal(createHash('sha256').update(body).digest('hex'), file.sha256);
      return route.fulfill({ contentType: 'text/plain; charset=utf-8', headers: { 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" }, body });
    }
    if (url.pathname.startsWith('/previews/')) return route.fulfill({
      contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': PREVIEW_CSP },
      body: '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Local QA</title><body><p>Изолированное локальное превью</p><script>document.body.dataset.qaReady="true";</script></body></html>',
    });
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/previews/')) previewResponses.push({ url: response.url(), status: response.status(), headers: response.headers() }); });
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base) { resourceRequests.push(url.href); if (url.pathname.startsWith('/previews/')) previewRequests.push(url.pathname); } });
  const cards = () => page.locator('.catalog-results:visible .pack-card');
  const collection = () => page.locator('.collection-page');
  const assetPage = () => page.locator('.asset-page');
  async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForLoadState('networkidle'); }
  async function gated(count, label) {
    await settle();
    assert.equal(await page.locator('iframe').count(), 0, `${label}: no iframe`);
    assert.equal(previewRequests.length, count, `${label}: no transient preview request`);
    assert.equal(await page.getByRole('button', { name: 'Запустить превью', exact: true }).count(), 0);
  }
  async function preview(scope, pack) {
    const frameNode = scope.locator('.live-preview iframe');
    await frameNode.waitFor();
    assert.equal(await frameNode.getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await frameNode.getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(await frameNode.getAttribute('src'), pack.previewUrl);
    const handle = await frameNode.elementHandle();
    try {
      const frame = await handle.contentFrame();
      await frame.waitForFunction(() => document.body?.dataset.qaReady === 'true');
      assert.equal(await frame.evaluate(() => { try { return parent.document ? 'accessible' : 'unexpected'; } catch { return 'isolated'; } }), 'isolated');
    } finally { await handle.dispose(); }
    await settle();
    assert.equal(previewRequests.at(-1), pack.previewUrl);
  }
  async function rootLoad() { await page.goto('about:blank'); await page.goto(base, { waitUntil: 'networkidle' }); }

  await rootLoad(); await cards().first().waitFor();
  assert.equal(await cards().count(), 1, 'Only latest version has a catalog card');
  assert.equal(await cards().locator('.pack-link').getAttribute('href'), '#pack=qa-script-pack');
  await assertCatalogControls(page); await assertStableLinks(page);
  await preview(cards().first(), versions[1]);
  assert.equal(previewRequests.length, 1, 'Reviewed latest-version cover autoplays once');
  await cards().locator('.pack-link').click(); await collection().waitFor();
  assert.equal(await page.locator('[role="dialog"], .pack-detail').count(), 0);
  await preview(collection().locator('.asset-card').first(), versions[1]);
  assert.equal(previewRequests.length, 2, 'Inline collection starts its individual preview');
  await collection().locator('.asset-link').first().click(); await assetPage().waitFor();
  await preview(assetPage(), versions[1]);
  await assetPage().locator('.code-source code').waitFor();
  assert.equal(await assetPage().locator('.code-source code').textContent(), rawBodies.get(versions[1].assets[0].path).toString('utf8'));
  assert.equal(previewRequests.length, 3);
  checks.push('reviewed-cover-collection-asset-autoplay', 'opaque-sandbox');

  await verifyLatestRouting({ page, base, catalog, latest: [versions[1]], checks });
  assertLatestResourceRequests(resourceRequests, [versions[1]]);
  assert.ok(previewRequests.every(url => url.includes('/qa-script-pack/2.0.0/')), 'Legacy links never request historical previews, even transiently');
  for (const hash of ['pack=qa-script-pack&asset=retired-only', 'pack=qa-script-pack&pack=qa-script-pack', 'pack=qa-script-pack&folder=visual', 'pack=qa-script-pack&unknown=true']) {
    await page.evaluate(value => { location.hash = value; }, hash);
    await page.getByRole('heading', { name: 'Страница не найдена', exact: true }).waitFor();
    assert.equal(await page.locator('.collection-page, .asset-page, iframe').count(), 0);
    await assertCatalogControls(page);
  }
  checks.push('canonical-unknown-asset-and-conflicting-params-fail-closed');

  // A catalog whose newest import has not opted into autoplay must still deny
  // execution. This is distinct from a stale link to an older published version.
  const beforeDenied = previewRequests.length;
  catalog = { schemaVersion: 1, packs: [versions[0]] };
  await rootLoad(); await cards().first().waitFor(); await gated(beforeDenied, 'Unapproved latest cover');
  await cards().locator('.pack-link').click(); await collection().waitFor(); await gated(beforeDenied, 'Unapproved latest collection');
  await collection().locator('.asset-link').first().click(); await assetPage().waitFor(); await gated(beforeDenied, 'Unapproved latest asset');
  await assertCatalogControls(page); await assertStableLinks(page);
  catalog = { schemaVersion: 1, packs: [] }; await rootLoad();
  await page.getByRole('heading', { name: 'Пока нет коллекций', exact: true }).waitFor(); assert.equal(await cards().count(), 0); await gated(beforeDenied, 'Empty catalog'); await assertCatalogControls(page);
  checks.push('latest-unapproved-script-denial', 'empty-catalog');

  const malformed = [
    pack => { pack.scripts = 'false'; },
    pack => { pack.scripts = false; pack.autoplay = true; },
    pack => { pack.folder.id = '../escape'; },
    pack => { pack.assets[0].url = '/raw/another-pack/1.0.0/tokens.css'; },
    pack => { pack.assets[0].previewUrl = versions[1].previewUrl; },
  ];
  for (const mutate of malformed) {
    const pack = structuredClone(versions[0]); mutate(pack); catalog = { schemaVersion: 1, packs: [pack] };
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Каталог не загрузился', exact: true }).waitFor(); await gated(beforeDenied, 'Rejected metadata');
  }
  const beforeRetry = catalogRequests; catalog = { schemaVersion: 1, packs: [versions[0]] };
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click(); await cards().first().waitFor();
  assert.equal(catalogRequests, beforeRetry + 1); await gated(beforeDenied, 'Recovered unapproved latest catalog');
  checks.push('malformed-new-metadata-rejected', 'retry-one-request');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(cspErrors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ ok: true, engine, localOnly: true, checks, previewRequests, errors, consoleErrors, cspErrors, external }));
} catch (error) {
  const frames = page ? await Promise.all(page.frames().map(async frame => ({ url: frame.url(), ...(await frame.evaluate(() => ({ charset: document.characterSet, bodyText: document.body?.innerText.slice(0, 1200) })).catch(failure => ({ error: failure.message }))) }))) : [];
  console.error(JSON.stringify({ error: error.message, checks, previewRequests, previewResponses, errors, consoleErrors, cspErrors, external, frames })); throw error;
} finally { if (browser) await browser.close(); if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
