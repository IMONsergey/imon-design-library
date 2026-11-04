// Local-only, disposable browser QA. Never targets production or an existing profile.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROME_BIN=/path/to/chrome node tests/browser-edge-cases.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer, PREVIEW_CSP } from '../scripts/serve.mjs';
import { createCatalogFixture } from './helpers/catalog-fixture.mjs';

assert.ok(!process.env.LIBRARY_URL, 'Unset LIBRARY_URL: edge cases only serve the local dist directory');
const root = path.resolve('dist');
const fixture = createCatalogFixture({ id: 'qa-edge-boundary', version: '1.0.0' });
let realCatalog;
try {
  realCatalog = structuredClone(fixture.catalog);
} finally {
  // Only metadata is needed: preview responses below are intentionally mocked.
  // The production catalog may be empty and must never receive QA content.
  fixture.cleanup();
}
assert.equal(realCatalog.packs.length, 1, 'The disposable fixture supplies one generated pack');
function scriptPack(version) {
  const pack = structuredClone(realCatalog.packs[0]);
  const previewPath = pack.previewUrl.split(`/previews/${pack.id}/${pack.version}/`)[1];
  assert.ok(previewPath, 'Sample has a generated preview URL');
  pack.id = 'qa-script-pack'; pack.version = version; pack.scripts = true;
  pack.previewUrl = `/previews/${pack.id}/${version}/${previewPath}`;
  pack.downloadUrl = `/downloads/${pack.id}-${version}.zip`;
  pack.manifestUrl = `/api/packs/${pack.id}/${version}.json`;
  pack.files = pack.files.map(file => ({ ...file, url: `/raw/${pack.id}/${version}/${file.path}` }));
  return pack;
}
const versions = [scriptPack('1.0.0'), scriptPack('2.0.0')];
let catalog = { schemaVersion: 1, packs: versions }, catalogRequests = 0;
const previewRequests = [], previewResponses = [], errors = [], consoleErrors = [], external = [];
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const server = createStaticServer(root);
let browser, page;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  // Fresh context has no workers; Playwright's block init script itself throws in opaque sandbox frames.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { external.push(url.href); return route.abort(); }
    if (url.pathname === '/api/catalog.json') { catalogRequests++; return route.fulfill({ json: catalog }); }
    if (url.pathname.startsWith('/previews/')) return route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': PREVIEW_CSP }, body: '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Local QA</title><body><p>Изолированное локальное превью</p></body></html>' });
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/previews/')) previewResponses.push({ url: response.url(), status: response.status(), headers: response.headers() }); });
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && url.pathname.startsWith('/previews/')) previewRequests.push(url.pathname); });
  const cards = () => page.locator('.catalog-results:visible .pack-card');
  const launch = () => page.getByRole('button', { name: 'Запустить превью', exact: true });
  async function settle() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForLoadState('networkidle');
  }
  async function gated(count, label) {
    await settle();
    assert.equal(await page.locator('iframe').count(), 0, `${label}: no iframe, even transient requests must be absent`);
    assert.equal(previewRequests.length, count, `${label}: no preview request before explicit launch`);
  }
  async function runPreview(pack) {
    const count = previewRequests.length;
    await launch().click();
    await page.frameLocator('.detail-frame').getByText('Изолированное локальное превью', { exact: true }).waitFor();
    assert.equal(await page.locator('.detail-frame').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.locator('.detail-frame').getAttribute('src'), pack.previewUrl);
    assert.equal(previewRequests.length, count + 1, 'Exactly one requested preview after a manual launch');
    assert.equal(previewRequests.at(-1), pack.previewUrl);
  }
  await page.goto(base, { waitUntil: 'networkidle' });
  await cards().first().waitFor();
  assert.equal(await cards().count(), 1, 'Two versions produce only the latest catalog card');
  await gated(0, 'Script pack card');
  await cards().locator('.pack-link').click();
  await launch().waitFor();
  await gated(0, 'Initial dialog');
  await runPreview(versions[1]);
  await page.getByRole('button', { name: 'Закрыть пак', exact: true }).click();
  await page.locator('.pack-detail').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !new URLSearchParams(location.hash.slice(1)).has('pack'));
  await cards().locator('.pack-link').click();
  await launch().waitFor();
  await gated(1, 'Reopened same version');
  await runPreview(versions[1]);
  await page.getByRole('combobox', { name: 'Версия пака', exact: true }).click();
  await page.getByRole('option', { name: 'v1.0.0', exact: true }).click();
  await launch().waitFor();
  await gated(2, 'Version switch after running a different version');
  await runPreview(versions[0]);
  catalog = { schemaVersion: 1, packs: [] };
  await page.goto('about:blank');
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Пока нет паков', exact: true }).waitFor();
  assert.equal(await cards().count(), 0);
  catalog = { schemaVersion: 1, packs: [{ ...versions[0], scripts: 'false' }] };
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Каталог не загрузился', exact: true }).waitFor();
  const beforeRetry = catalogRequests;
  catalog = { schemaVersion: 1, packs: versions };
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await cards().first().waitFor();
  assert.equal(catalogRequests, beforeRetry + 1, 'Retry performs one new catalog request');
  await gated(3, 'Recovered catalog');
  assert.deepEqual(errors, [], 'No uncaught page errors');
  assert.deepEqual(consoleErrors, [], 'No browser console or CSP errors');
  assert.deepEqual(external, [], 'No external requests');
  console.log(JSON.stringify({ ok: true, localOnly: true, checks: ['script-card-gate', 'first-launch', 'reopen-gate', 'version-request-gate', 'empty-catalog', 'malformed-retry'], previewRequests, errors, consoleErrors, external }));
} catch (error) {
  const frames = page ? await Promise.all(page.frames().map(async frame => ({ url: frame.url(), ...(await frame.evaluate(() => ({ charset: document.characterSet, bodyText: document.body?.innerText.slice(0, 1200), html: document.documentElement?.outerHTML.slice(0, 1500) })).catch(failure => ({ error: failure.message }))) }))) : [];
  console.error(JSON.stringify({ error: error.message, previewRequests, previewResponses, errors, consoleErrors, external, frames }));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
