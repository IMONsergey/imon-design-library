// Optional integration runner. Playwright is a QA-only tool, never a site dependency.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROME_BIN=/path/to/chrome node tests/browser-smoke.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';

const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
let server;
let base = process.env.LIBRARY_URL;
if (!base) {
  server = createStaticServer(path.resolve('dist'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const external = [];
page.on('request', request => { if (!request.url().startsWith(base) && /^https?:/.test(request.url())) external.push(request.url()); });
const overflow = async () => {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].map(node => ({ name: node.id || node.className || node.tagName, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })).filter(node => node.right > innerWidth + 1 && node.width > 0).slice(0, 12) }));
  if (metrics.scroll > metrics.width + 1 && screenshots) await page.screenshot({ path: path.join(screenshots, 'overflow.png'), fullPage: true });
  assert.ok(metrics.scroll <= metrics.width + 1, `No page horizontal overflow: ${JSON.stringify(metrics)}`);
};
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.pack-card').first().waitFor();
  assert.equal(await page.locator('.pack-card').count(), 3);
  assert.match(await page.locator('#totals').innerText(), /3 пака.*11 ассетов/);
  await overflow();
  const frames = page.frames().filter(frame => frame !== page.mainFrame());
  assert.equal(frames.length, 3);
  for (const frame of frames) {
    assert.equal(await frame.evaluate(() => { try { return parent.document.body ? 'accessible' : 'other'; } catch { return 'isolated'; } }), 'isolated');
    assert.ok(await frame.locator('body').innerText(), 'Preview contains real content');
  }
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });
  await page.locator('#search').fill('motion');
  assert.equal(await page.locator('.pack-card').count(), 1);
  await page.locator('#search').fill('zzzz-not-found');
  assert.equal(await page.locator('.pack-card').count(), 0);
  assert.equal(await page.locator('#status').isVisible(), true);
  await page.locator('#clear-search').click();
  await page.locator('.bookmark').first().click();
  await page.locator('[data-category="favorites"]').click();
  assert.equal(await page.locator('.pack-card').count(), 1);
  await page.locator('[data-category="all"]').click();
  await page.locator('#list-view').click();
  assert.equal(await page.locator('#pack-grid').getAttribute('class'), 'pack-grid list-mode');
  await page.locator('#grid-view').click();
  await page.locator('.card-open').first().click();
  assert.equal(await page.locator('#pack-dialog').isVisible(), true);
  assert.match(new URL(page.url()).hash, /^#pack=/);
  await page.locator('#preview-mobile').click();
  assert.ok((await page.locator('#preview-stage').getAttribute('class')).includes('mobile-preview'));
  await page.locator('#tab-files').click();
  await page.locator('#copy-code:enabled').waitFor();
  assert.ok((await page.locator('#code-content').innerText()).length > 20);
  assert.match(await page.locator('#file-info').innerText(), /SHA-256 [0-9a-f]{64}/);
  await page.locator('#tab-files').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-guide').getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('.asset-entry').count());
  await page.locator('#tab-preview').click();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'pack.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.locator('#download-pack').click();
  assert.match((await download).suggestedFilename(), /\.zip$/);
  await page.locator('#close-pack').click();
  assert.equal(await page.locator('#pack-dialog').isVisible(), false);
  assert.equal(new URL(page.url()).hash, '');
  await page.locator('#how-to').click();
  assert.equal(await page.locator('#add-dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#add-dialog').isVisible(), false);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await overflow();
    if (width === 390 && screenshots) await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });
    await page.locator('.card-open').first().click();
    await overflow();
    const bounds = await page.locator('#pack-dialog').boundingBox();
    assert.ok(bounds.width <= width && bounds.x >= 0, `Dialog fits ${width}px`);
    await page.locator('#tab-files').click();
    await page.locator('#copy-code:enabled').waitFor();
    await overflow();
    await page.locator('#close-pack').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#menu-button').click();
  await page.locator('[data-category="motion"]').click();
  assert.equal(await page.locator('.pack-card').count(), 1);
  assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(errors, [], 'No uncaught page errors');
  assert.deepEqual(external, [], 'No external requests from the catalog or previews');
  console.log(JSON.stringify({ ok: true, base, viewports: [320, 390, 768, 1440], packs: 3, assertions: 'catalog, search, empty, favorites, list, preview isolation, files, keyboard, download, mobile', errors, external }));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
