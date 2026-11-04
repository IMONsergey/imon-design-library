// Local-only, disposable browser QA. Never targets production or a user profile.
// The fixture is generated in mkdtemp, then only its metadata is retained.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer, PREVIEW_CSP } from '../scripts/serve.mjs';
import { validatePack } from '../frontend/catalog.mjs';
import { createCatalogFixture } from './helpers/catalog-fixture.mjs';

assert.ok(!process.env.LIBRARY_URL, 'Unset LIBRARY_URL: edge QA serves only the local UI build');
const fixture = createCatalogFixture({ id: 'qa-edge-boundary', version: '1.0.0' });
let sample;
try { sample = structuredClone(fixture.catalog.packs[0]); } finally { fixture.cleanup(); }
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
    ...asset, id: autoplay ? `${asset.id}-new` : asset.id,
    url: `/raw/${pack.id}/${version}/${asset.path}`,
    ...(index === 0 ? { previewUrl: pack.previewUrl } : {}),
  }));
  return pack;
}
const versions = [scriptPack('1.0.0', false), scriptPack('2.0.0', true)];
let catalog = { schemaVersion: 1, packs: versions }, catalogRequests = 0;
for (const pack of versions) validatePack(pack, 'http://127.0.0.1');
const previewRequests = [], previewResponses = [], errors = [], consoleErrors = [], cspErrors = [], external = [], checks = [];
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
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && url.pathname.startsWith('/previews/')) previewRequests.push(url.pathname); });
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
  async function chooseVersion(version) { await page.getByRole('combobox', { name: 'Версия коллекции', exact: true }).click(); await page.getByRole('option', { name: `v${version}`, exact: true }).click(); }
  async function rootLoad() { await page.goto('about:blank'); await page.goto(base, { waitUntil: 'networkidle' }); }

  await rootLoad(); await cards().first().waitFor();
  assert.equal(await cards().count(), 1, 'Only latest version has a catalog card');
  await preview(cards().first(), versions[1]);
  assert.equal(previewRequests.length, 1, 'Reviewed latest-version cover autoplays once');
  await cards().locator('.pack-link').click(); await collection().waitFor();
  assert.equal(await page.locator('[role="dialog"], .pack-detail').count(), 0);
  await preview(collection().locator('.asset-card').first(), versions[1]);
  assert.equal(previewRequests.length, 2, 'Inline collection starts its individual preview');
  await collection().locator('.asset-link').first().click(); await assetPage().waitFor();
  await preview(assetPage(), versions[1]);
  assert.equal(previewRequests.length, 3);
  checks.push('reviewed-cover-collection-asset-autoplay', 'opaque-sandbox');

  const historyBeforeVersion = await page.evaluate(() => history.length);
  await chooseVersion('1.0.0'); await collection().waitFor();
  await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('pack') === 'qa-script-pack@1.0.0' && !new URLSearchParams(location.hash.slice(1)).has('asset'));
  await gated(3, 'Missing asset in older version falls back to the inactive collection');
  assert.equal(await page.evaluate(() => history.length), historyBeforeVersion, 'Version switching replaces history');
  await collection().locator('.asset-link').first().click(); await assetPage().waitFor(); await gated(3, 'Legacy asset page');
  await chooseVersion('2.0.0'); await collection().waitFor();
  await preview(collection().locator('.asset-card').first(), versions[1]);
  assert.equal(previewRequests.length, 4);
  checks.push('version-missing-asset-fallback', 'legacy-version-never-launches');

  catalog = { schemaVersion: 1, packs: [versions[0]] };
  await rootLoad(); await cards().first().waitFor(); await gated(4, 'Legacy catalog cover');
  await cards().locator('.pack-link').click(); await collection().waitFor(); await gated(4, 'Legacy inline collection');
  await collection().locator('.asset-link').first().click(); await assetPage().waitFor(); await gated(4, 'Reopened legacy asset');
  catalog = { schemaVersion: 1, packs: [] }; await rootLoad();
  await page.getByRole('heading', { name: 'Пока нет коллекций', exact: true }).waitFor(); assert.equal(await cards().count(), 0); await gated(4, 'Empty catalog');
  checks.push('legacy-card-and-navigation-denial', 'empty-catalog');

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
    await page.getByRole('heading', { name: 'Каталог не загрузился', exact: true }).waitFor(); await gated(4, 'Rejected metadata');
  }
  const beforeRetry = catalogRequests; catalog = { schemaVersion: 1, packs: [versions[0]] };
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click(); await cards().first().waitFor();
  assert.equal(catalogRequests, beforeRetry + 1); await gated(4, 'Recovered legacy catalog');
  checks.push('malformed-new-metadata-rejected', 'retry-one-request');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(cspErrors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ ok: true, engine, localOnly: true, checks, previewRequests, errors, consoleErrors, cspErrors, external }));
} catch (error) {
  const frames = page ? await Promise.all(page.frames().map(async frame => ({ url: frame.url(), ...(await frame.evaluate(() => ({ charset: document.characterSet, bodyText: document.body?.innerText.slice(0, 1200) })).catch(failure => ({ error: failure.message }))) }))) : [];
  console.error(JSON.stringify({ error: error.message, checks, previewRequests, previewResponses, errors, consoleErrors, cspErrors, external, frames })); throw error;
} finally { if (browser) await browser.close(); if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
