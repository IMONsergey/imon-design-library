// Real WebGL QA in a fresh headless browser, never in an existing user profile.
// npm run build && PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-diamonds.mjs
// BROWSER_ENGINE=chromium|firefox|webkit; CHROME_BIN/FIREFOX_BIN/WEBKIT_BIN;
// optional LIBRARY_URL and SCREENSHOTS_DIR. No software-renderer flags are forced.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';
import { validatePack } from '../frontend/catalog.mjs';
import { assertCatalogControls, assertStableLinks, assertLatestResourceRequests } from './browser-latest.mjs';

const ID = 'visual-weblg', VERSION = '1.1.0', KEY = `${ID}@${VERSION}`;
const CUTS = ['round', 'oval', 'pear', 'marquise', 'cushion', 'princess', 'emerald', 'radiant', 'asscher', 'trillion'];
const ORIGINAL_SHA = '59ceac923be98dd8cf158fab14b9b221f61fea045f75463eaddb0ffcc89ea402';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const executablePath = { chromium: process.env.CHROME_BIN, firefox: process.env.FIREFOX_BIN, webkit: process.env.WEBKIT_BIN }[engine];
const screenshots = process.env.SCREENSHOTS_DIR ? path.resolve(process.env.SCREENSHOTS_DIR) : null;
if (screenshots) await mkdir(screenshots, { recursive: true });
const errors = [], consoleErrors = [], cspErrors = [], external = [], httpErrors = [], resourceRequests = [], warnings = [], checks = [], states = {}, layouts = [];
let server, browser, context, page, base, phase = 'startup';

async function poll(label, action, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`${label}: timeout`);
}
async function glState(frame) {
  return frame.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl');
    if (!gl) return { available: false, text: document.body.innerText };
    const lost = gl.isContextLost(), errorBefore = gl.getError();
    if (lost) return { available: true, lost, errorBefore };
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const uniform = name => { const loc = program && gl.getUniformLocation(program, name); return loc ? gl.getUniform(program, loc) : null; };
    const rotation = uniform('rot'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { available: true, lost, errorBefore, errorAfter: gl.getError(),
      width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
      linked: !!program && gl.getProgramParameter(program, gl.LINK_STATUS),
      rotation: rotation ? [...rotation] : null, count: uniform('count'), alpha: uniform('alpha'),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      cut: document.querySelector('[data-cut]')?.dataset.cut,
      status: document.querySelector('[data-cut]')?.dataset.status,
      innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    };
  });
}
async function pixelEvidence(frame) {
  const result = await frame.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl');
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let samples = 0, facets = 0;
    // Center region includes gem facets, excluding the separate bottom shadow.
    // Neither a black lost buffer nor an empty white stage can satisfy this.
    for (let y = Math.floor(height * .3); y < height * .7; y += 2) {
      for (let x = Math.floor(width * .25); x < width * .75; x += 2) {
        const offset = (y * width + x) * 4;
        const low = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        const high = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        samples++; if (low < 235 && high > 100) facets++;
      }
    }
    return { preserved: gl.getContextAttributes().preserveDrawingBuffer, samples, facets, ratio: facets / samples, error: gl.getError() };
  });
  assert.equal(result.preserved, true, 'Idle previews retain their drawn frame without a permanent redraw loop');
  assert.equal(result.error, 0);
  assert.ok(result.ratio > .025, `The gem must exist in actual pixels, not only in WebGL uniforms: ${JSON.stringify(result)}`);
  return result;
}
async function ready(locator, cut) {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await locator.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(await locator.getAttribute('src'), `/previews/${ID}/${VERSION}/assets/${cut}.html`);
  const frame = await (await locator.elementHandle()).contentFrame();
  assert.ok(frame);
  await frame.locator('canvas').waitFor({ state: 'visible' });
  let last;
  await poll(`${cut} WebGL draws without a launch gesture`, async () => {
    last = await glState(frame);
    assert.ok(last.available, `WebGL unavailable: ${JSON.stringify(last)}`);
    assert.notEqual(last.status, 'unavailable', `Renderer initialization failed: ${JSON.stringify(last)}`);
    assert.equal(last.lost, false, 'WebGL context must remain alive');
    assert.equal(last.errorBefore, 0, 'Renderer must report WebGL NO_ERROR');
    assert.equal(last.errorAfter, 0);
    return last.status === 'ready' && last.linked && last.count > 0 && last.alpha >= .999 && last.rotation?.length === 9;
  });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pixels = await pixelEvidence(frame);
  assert.equal(last.cut, cut, 'The card runs its own cut, not a shared picker');
  assert.ok(last.width > 0 && last.height > 0);
  assert.ok(last.scrollWidth <= last.innerWidth + 1 && last.scrollHeight <= last.innerHeight + 1, `Preview must fit its frame: ${JSON.stringify(last)}`);
  assert.equal(await frame.locator('.dc5-picker, [aria-label="Формы огранки"]').count(), 0, 'No hidden ten-cut selector in an individual asset');
  assert.equal(await frame.evaluate(() => { try { return !!parent.document.body; } catch { return false; } }), false, 'The asset cannot access the catalog DOM');
  states[cut] = { ...last, pixels };
  return frame;
}
async function noPopup() {
  assert.equal(await page.getByRole('dialog').count(), 0, 'Browsing assets never opens a popup');
  assert.equal(await page.getByRole('button', { name: 'Запустить превью', exact: true }).count(), 0, 'This reviewed collection has no launch gate');
  await assertCatalogControls(page);
  await assertStableLinks(page);
}
async function noOverflow(name) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `${name} horizontal overflow: ${JSON.stringify(size)}`);
  layouts.push({ name, ...size });
}
async function shot(name) {
  if (!screenshots) return;
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), animations: 'allow', caret: 'initial' });
}
async function browserDownload(link) {
  const waiting = page.waitForEvent('download');
  await link.click();
  const download = await waiting, stream = await download.createReadStream(), chunks = [];
  assert.ok(stream);
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(await download.failure(), null);
  return { filename: download.suggestedFilename(), body: Buffer.concat(chunks) };
}
const near = (a, b, tolerance = .02) => a?.length === b?.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

try {
  if (process.env.LIBRARY_URL) {
    const url = new URL(process.env.LIBRARY_URL);
    assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
    base = url.origin;
  } else {
    server = createStaticServer(path.resolve('dist'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', locale: 'ru-RU' });
  await context.exposeBinding('__imonDiamondsCsp', ({ frame }, violation) => cspErrors.push({ frame: frame.url(), ...violation }));
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
    globalThis.__imonDiamondsCsp({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber }).catch(() => {});
  }));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  context.on('page', opened => {
    opened.on('pageerror', error => errors.push(error.message));
    opened.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); else if (message.type() === 'warning') warnings.push(message.text()); });
    opened.on('response', response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
    opened.on('request', request => { if (/^https?:/.test(request.url())) resourceRequests.push(request.url()); });
  });

  phase = 'catalog-and-ten-independent-downloads';
  const response = await context.request.get('/api/catalog.json', { maxRedirects: 0 });
  assert.equal(response.status(), 200);
  const catalog = await response.json();
  const pack = validatePack(catalog.packs.find(item => item.id === ID && item.version === VERSION), base);
  assert.equal(pack.title, 'Diamonds Collection');
  assert.deepEqual(pack.folder, { id: 'visual', title: 'Visual' });
  assert.equal(pack.autoplay, true);
  assert.equal(pack.scripts, true);
  assert.deepEqual(pack.assets.map(asset => asset.id), CUTS);
  assert.equal(pack.previewUrl, `/previews/${ID}/${VERSION}/assets/round.html`);
  const hashes = new Set();
  for (const asset of pack.assets) {
    assert.equal(asset.path, `assets/${asset.id}.html`);
    assert.equal(asset.previewUrl, `/previews/${ID}/${VERSION}/${asset.path}`);
    assert.equal(asset.url, `/raw/${ID}/${VERSION}/${asset.path}`);
    const raw = await context.request.get(asset.url, { maxRedirects: 0 });
    assert.equal(raw.status(), 200);
    const body = await raw.body(), file = pack.files.find(file => file.path === asset.path);
    assert.equal(digest(body), file.sha256);
    hashes.add(file.sha256);
    assert.match(raw.headers()['content-disposition'], /attachment/);
    const preview = await context.request.get(asset.previewUrl, { maxRedirects: 0 });
    assert.equal(preview.status(), 200);
    assert.equal(digest(await preview.body()), file.sha256, 'Live preview is the exact downloadable self-contained HTML');
    assert.match(preview.headers()['content-security-policy'], /sandbox allow-scripts/);
    assert.doesNotMatch(preview.headers()['content-security-policy'], /allow-same-origin/);
  }
  assert.equal(hashes.size, 10, 'Ten distinct self-contained files');
  const legacy = catalog.packs.find(item => item.id === ID && item.version === '1.0.0');
  assert.ok(legacy, 'The previous published version remains available');
  const original = legacy.files.find(file => file.path === 'diamond-cut-study-restored.html');
  assert.equal(digest(await (await context.request.get(original.url)).body()), ORIGINAL_SHA);
  checks.push(phase);

  phase = 'folder-and-live-collection-cover';
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const card = () => page.locator(`.pack-card[data-pack="${KEY}"]`);
  await card().waitFor();
  assert.equal(await card().locator('.pack-link').getAttribute('href'), `#pack=${ID}`);
  assert.equal(await page.locator(`.pack-card[data-pack="${ID}@1.0.0"]`).count(), 0, 'Historical version is not duplicated in the latest catalog');
  const coverFrame = await ready(card().locator('iframe'), 'round');
  for (let repeat = 0; repeat < 3; repeat++) {
    await coverFrame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await pixelEvidence(coverFrame);
  }
  await noPopup();
  await page.locator('.folder-nav[data-folder="visual"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('folder') === 'visual');
  assert.equal(await page.locator('h1.page-title').innerText(), 'Visual');
  await ready(card().locator('iframe'), 'round');
  await shot('diamonds-folder-light');
  await card().locator('.pack-link').click();
  await page.locator(`.collection-page[data-pack="${KEY}"]`).waitFor();
  await noPopup();
  checks.push(phase);

  phase = 'ten-inline-live-cards';
  await page.setViewportSize({ width: 1440, height: 720 });
  const tiles = page.locator('.asset-grid > .asset-card');
  assert.deepEqual(await tiles.evaluateAll(nodes => nodes.map(node => node.dataset.asset)), CUTS);
  await ready(page.locator('.asset-card[data-asset="round"] iframe'), 'round');
  const initialFrames = await page.locator('.asset-card iframe').count();
  assert.ok(initialFrames > 0 && initialFrames < 10, 'Visible cards start immediately; distant cards are not all running');
  let firstFrame;
  for (const cut of CUTS) {
    const tile = page.locator(`.asset-card[data-asset="${cut}"]`);
    await tile.scrollIntoViewIfNeeded();
    const frame = await ready(tile.locator('iframe'), cut);
    if (cut === 'round') firstFrame = frame;
    assert.equal(await tile.locator('.asset-link').getAttribute('href'), `#pack=${ID}&asset=${cut}`);
    assert.equal(await tile.locator('.asset-download').getAttribute('href'), `/raw/${ID}/${VERSION}/assets/${cut}.html`);
  }
  await noPopup();
  // A single-column mobile layout makes the first tile genuinely distant,
  // rather than assuming that a generous desktop viewport cannot fit all rows.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.asset-card[data-asset="trillion"]').scrollIntoViewIfNeeded();
  await ready(page.locator('.asset-card[data-asset="trillion"] iframe'), 'trillion');
  await poll('Distant round preview is released after scrolling', async () => firstFrame.isDetached());
  const last = page.locator('.asset-card[data-asset="trillion"]');
  const downloaded = await browserDownload(last.locator('.asset-download'));
  assert.ok(downloaded.filename.endsWith('.html'));
  assert.equal(digest(downloaded.body), pack.files.find(file => file.path === 'assets/trillion.html').sha256);
  checks.push(phase);

  phase = 'individual-inline-page-camera-and-history';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await last.locator('.asset-link').click();
  const assetPage = () => page.locator('.asset-page[data-asset="trillion"]');
  await assetPage().waitFor();
  await noPopup();
  let frame = await ready(assetPage().locator('iframe'), 'trillion');
  await frame.getByRole('button', { name: 'Вид сверху', exact: true }).click();
  await poll('Top camera updates the rendering matrix', async () => near((await glState(frame)).rotation, [1, 0, 0, 0, 0, 1, 0, -1, 0]));
  await frame.getByRole('button', { name: 'Ракурс 3/4', exact: true }).click();
  await poll('Three-quarter camera updates the rendering matrix', async () => near((await glState(frame)).rotation, [1, 0, 0, 0, Math.cos(.92), Math.sin(.92), 0, -Math.sin(.92), Math.cos(.92)]));
  const canvas = frame.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const before = (await glState(frame)).rotation, rect = await canvas.boundingBox();
  assert.ok(rect && rect.width > 240 && rect.height > 200);
  await page.mouse.move(rect.x + rect.width * .4, rect.y + rect.height * .5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .55, rect.y + rect.height * .6, { steps: 12 });
  await page.mouse.up();
  await poll('Pointer rotates the actual WebGL scene', async () => !near((await glState(frame)).rotation, before, .05));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assetPage().waitFor();
  frame = await ready(assetPage().locator('iframe'), 'trillion');
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('asset'), 'trillion');
  await shot('diamonds-individual-trillion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await frame.locator('[data-motion="auto"]').waitFor();
  const stationary = (await glState(frame)).rotation;
  await poll('Soft automatic rotation starts after idle', async () => !near((await glState(frame)).rotation, stationary, .035));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frame.locator('[data-motion="reduced"]').waitFor();
  await frame.getByRole('button', { name: 'Сбросить положение', exact: true }).click();
  await poll('Reduced motion returns to the selected camera', async () => near((await glState(frame)).rotation, [1, 0, 0, 0, Math.cos(.92), Math.sin(.92), 0, -Math.sin(.92), Math.cos(.92)]));
  await page.goBack();
  await page.locator('.collection-page').waitFor();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('asset'), null);
  await noPopup();
  checks.push(phase);

  phase = 'responsive-light-and-dark';
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    for (const theme of ['light', 'dark']) {
      await page.locator('.theme-switch').getByLabel(theme === 'light' ? 'Светлая тема' : 'Темная тема', { exact: true }).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      const round = page.locator('.asset-card[data-asset="round"]');
      await round.scrollIntoViewIfNeeded();
      const roundFrame = await ready(round.locator('iframe'), 'round');
      await noOverflow(`${width}-${theme}-collection`);
      if (width === 390 || width === 1440) await shot(`diamonds-${width}-${theme}`);
      await pixelEvidence(roundFrame);
      if (width === 320) {
        const s = await glState(roundFrame);
        assert.ok(s.innerWidth <= 320 && s.width <= 480 && s.height <= 480, 'Small preview uses a bounded drawing buffer');
      }
    }
  }
  checks.push(phase);

  phase = 'visibility-lifecycle';
  // Synthetic visibility event in this disposable QA profile proves lifecycle
  // cleanup without relying on browser-specific headless tab-background rules.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await poll('Hidden document releases every preview iframe', () => page.locator('.live-preview iframe').count().then(count => count === 0));
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await ready(page.locator('.asset-card[data-asset="round"] iframe'), 'round');
  checks.push(phase);

  assert.deepEqual(errors, [], 'No uncaught JavaScript errors');
  assert.deepEqual(consoleErrors, [], 'No browser console errors');
  assert.deepEqual(cspErrors, [], 'No CSP violations');
  assert.deepEqual(external, [], 'No third-party requests');
  assert.deepEqual(httpErrors, [], 'No failed browser HTTP responses');
  assertLatestResourceRequests(resourceRequests, [pack]);
  console.log(JSON.stringify({ ok: true, engine, collection: KEY, assets: 10, checks, states, layouts, warnings }, null, 2));
} catch (error) {
  if (screenshots && page && !page.isClosed()) {
    try { await shot('diamonds-failure'); } catch (captureError) { warnings.push(captureError.message); }
  }
  console.error(JSON.stringify({ ok: false, engine, phase, message: error.message, checks, states, errors, consoleErrors, cspErrors, external, httpErrors, warnings }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
