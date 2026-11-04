// Historical 1.0.0 source/renderer QA, independent of the current catalog UI.
// Current folder/collection/individual-asset UI: tests/browser-diamonds.mjs.
// npm run build && node tests/browser-visual-weblg.mjs
// Uses PLAYWRIGHT_MODULE, BROWSER_ENGINE, CHROME_BIN/FIREFOX_BIN/WEBKIT_BIN,
// optional LIBRARY_URL and SCREENSHOTS_DIR. SOFTWARE_WEBGL=1 is explicit opt-in
// for Chromium SwiftShader; no GPU flags or existing profiles are used otherwise.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';
import { validatePack } from '../frontend/catalog.mjs';

const ID = 'visual-weblg', VERSION = '1.0.0', TITLE = 'Visual WebLG';
const ORIGINAL = 'diamond-cut-study-restored.html';
const ORIGINAL_SHA = '59ceac923be98dd8cf158fab14b9b221f61fea045f75463eaddb0ffcc89ea402';
const CUTS = [
  ['round', 'Круглая', 'Круглая бриллиантовая'], ['oval', 'Овал', 'Овальная бриллиантовая'],
  ['pear', 'Груша', 'Грушевидная бриллиантовая'], ['marquise', 'Маркиз', 'Маркиз'],
  ['cushion', 'Кушон', 'Кушон'], ['princess', 'Принцесса', 'Принцесса'],
  ['emerald', 'Изумруд', 'Изумрудная ступенчатая'], ['radiant', 'Радиант', 'Радиант'],
  ['asscher', 'Ашер', 'Ашер, ступенчатая'], ['trillion', 'Триллион', 'Триллион'],
];
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), 'Unknown BROWSER_ENGINE');
assert.ok([undefined, '0', '1'].includes(process.env.SOFTWARE_WEBGL), 'SOFTWARE_WEBGL must be 0 or 1');
const software = process.env.SOFTWARE_WEBGL === '1';
assert.ok(!software || engine === 'chromium', 'SOFTWARE_WEBGL=1 is supported only for Chromium');
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const executablePath = { chromium: process.env.CHROME_BIN, firefox: process.env.FIREFOX_BIN, webkit: process.env.WEBKIT_BIN }[engine];
const screenshots = process.env.SCREENSHOTS_DIR ? path.resolve(process.env.SCREENSHOTS_DIR) : null;
if (screenshots) await mkdir(screenshots, { recursive: true });
const errors = [], consoleErrors = [], warnings = [], cspErrors = [], external = [], httpErrors = [], previewRequests = [], checks = [], savedScreenshots = [];
let server, browser, context, page, frame, base, phase = 'startup', lastGl, renderer, mobileMetrics;

async function poll(label, callback, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await callback()) return; // Assertions are never swallowed or retried.
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`${label}: timeout; last WebGL state=${JSON.stringify(lastGl)}`);
}
async function frames() {
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function glState() {
  lastGl = await frame.evaluate(() => {
    const root = document.querySelector('#diamond-cuts-v5');
    const canvas = root?.querySelector('canvas'), error = root?.querySelector('.dc5-error');
    const state = { ready: root?.dataset.ready, errorVisible: !!error && getComputedStyle(error).display !== 'none', errorText: error?.textContent.trim(), canvas: !!canvas };
    const gl = canvas?.getContext('webgl');
    if (!gl) return { ...state, available: false };
    const lost = gl.isContextLost(), errorBefore = gl.getError();
    if (lost) return { ...state, available: true, lost, errorBefore };
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const uniform = name => { const location = program && gl.getUniformLocation(program, name); return location ? gl.getUniform(program, location) : null; };
    const rotation = uniform('rot'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...state, available: true, lost, errorBefore, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
      linked: !!program && gl.getProgramParameter(program, gl.LINK_STATUS), rotation: rotation ? [...rotation] : null,
      count: uniform('count'), alpha: uniform('alpha'), version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER), unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      errorAfter: gl.getError(), noError: gl.NO_ERROR };
  });
  assert.ok(lastGl.available, `WebGL unavailable (${engine}, SOFTWARE_WEBGL=${Number(software)}): ${JSON.stringify(lastGl)}`);
  assert.equal(lastGl.errorVisible, false, `Asset reported a WebGL/shader initialization failure: ${JSON.stringify(lastGl)}`);
  assert.equal(lastGl.lost, false, 'The asset WebGL context must not be lost');
  assert.equal(lastGl.errorBefore, lastGl.noError, 'WebGL rendering must report NO_ERROR');
  assert.equal(lastGl.errorAfter, lastGl.noError, 'WebGL inspection must report NO_ERROR');
  assert.ok(lastGl.width > 0 && lastGl.height > 0, 'WebGL has a nonempty drawing buffer');
  return lastGl;
}
async function rendered(label, predicate = () => true) {
  await frames();
  await poll(label, async () => {
    const state = await glState();
    return state.linked && state.rotation?.length === 9 && state.count > 0 && state.alpha >= .999 && predicate(state);
  });
  return lastGl;
}
const near = (actual, expected, tolerance = .02) => actual?.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const threeQuarter = [1, 0, 0, 0, Math.cos(.92), Math.sin(.92), 0, -Math.sin(.92), Math.cos(.92)];
async function sceneShot(name) {
  if (!screenshots) return;
  await frame.evaluate(() => scrollTo(0, 0));
  // Avoid screenshot-injected styles that can produce false WebKit CSP errors.
  await frame.locator('#diamond-cuts-v5 .dc5-stage').screenshot({ path: path.join(screenshots, `${name}.png`), animations: 'allow', caret: 'initial' });
  savedScreenshots.push(`${name}.png`);
}

try {
  if (process.env.LIBRARY_URL) {
    const url = new URL(process.env.LIBRARY_URL);
    assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Use a credential-free HTTP(S) LIBRARY_URL');
    base = url.origin;
  } else {
    server = createStaticServer(path.resolve('dist'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    ...(software ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', locale: 'ru-RU' });
  await context.exposeBinding('__imonVisualCsp', ({ frame: source }, violation) => cspErrors.push({ frame: source.url(), ...violation }));
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
    globalThis.__imonVisualCsp({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber }).catch(() => {});
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
  });

  phase = 'original-identity-and-hash';
  const catalogResponse = await context.request.get('/api/catalog.json', { maxRedirects: 0 });
  assert.equal(catalogResponse.status(), 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.schemaVersion, 1);
  const matches = catalog.packs.filter(pack => pack.id === ID && pack.version === VERSION);
  assert.equal(matches.length, 1, 'Exactly one published visual-weblg/1.0.0 manifest');
  const pack = validatePack(matches[0], base);
  assert.equal(pack.title, TITLE);
  assert.equal(pack.scripts, true);
  assert.equal(pack.assets.length, 1, 'The original is one asset, not ten invented assets');
  assert.equal(pack.assets[0].title, TITLE);
  assert.equal(pack.assets[0].path, ORIGINAL);
  const original = pack.files.find(file => file.path === ORIGINAL);
  assert.ok(original, 'The original HTML is exported');
  assert.equal(original.sha256, ORIGINAL_SHA);
  const rawResponse = await context.request.get(original.url, { maxRedirects: 0 });
  assert.equal(rawResponse.status(), 200);
  const originalBytes = await rawResponse.body();
  assert.equal(createHash('sha256').update(originalBytes).digest('hex'), ORIGINAL_SHA, 'Actual original bytes match the supplied source');
  const previewResponse = await context.request.get(pack.previewUrl, { maxRedirects: 0 });
  assert.equal(previewResponse.status(), 200);
  assert.ok((await previewResponse.body()).includes(originalBytes), 'The preview wraps the unchanged original HTML');
  checks.push(phase);

  phase = 'historical-renderer';
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith(`/previews/${ID}/${VERSION}/`)) previewRequests.push(request.url()); });
  const renderedResponse = await page.goto(`${base}${pack.previewUrl}`, { waitUntil: 'domcontentloaded' });
  assert.match(renderedResponse.headers()['content-security-policy'], /sandbox allow-scripts/);
  assert.doesNotMatch(renderedResponse.headers()['content-security-policy'], /allow-same-origin/);
  frame = page;
  await frame.locator('#diamond-cuts-v5[data-ready="1"]').waitFor();
  renderer = await rendered('Initial WebGL rendering');
  assert.match(renderer.version, /WebGL 1/i);
  assert.equal(previewRequests.length, 1, 'One explicit QA navigation creates one historical document');
  checks.push(phase);

  phase = 'ten-cuts';
  const picker = frame.locator('#diamond-cuts-v5 .dc5-picker');
  assert.equal(await picker.getAttribute('aria-label'), 'Формы огранки');
  assert.deepEqual(await picker.locator('button[data-cut]').evaluateAll(buttons => buttons.map(button => [button.dataset.cut, button.textContent.trim()])), CUTS.map(([id, label]) => [id, label]));
  assert.equal(await frame.locator('#dc5-name').innerText(), 'Круглая огранка');
  // Select round last so its source-specific initial label is not mistaken for
  // the longer label used after a real change of cut.
  for (const [id, label, description] of [...CUTS.slice(1), CUTS[0]]) {
    const button = picker.getByRole('button', { name: label, exact: true });
    assert.equal(await button.getAttribute('data-cut'), id);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await picker.locator('button[aria-pressed="true"]').count(), 1);
    assert.equal(await frame.locator('#dc5-name').innerText(), description);
    await rendered(`Cut ${id} renders without a WebGL error`);
  }
  checks.push(phase);

  phase = 'camera-pointer-and-reset';
  const views = frame.locator('#diamond-cuts-v5 .dc5-views');
  assert.equal(await views.getAttribute('aria-label'), 'Ракурс');
  await views.getByRole('button', { name: 'Сверху', exact: true }).click();
  assert.equal(await views.locator('[data-view="top"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await views.locator('[data-view="three"]').getAttribute('aria-pressed'), 'false');
  await rendered('Top camera changes the rendered rotation', state => near(state.rotation, [1, 0, 0, 0, 0, 1, 0, -1, 0]));
  await views.getByRole('button', { name: '3/4', exact: true }).click();
  assert.equal(await views.locator('[data-view="three"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await views.locator('[data-view="top"]').getAttribute('aria-pressed'), 'false');
  const beforeDrag = (await rendered('Three-quarter camera returns', state => near(state.rotation, threeQuarter))).rotation;
  const canvas = frame.locator('#diamond-cuts-v5 canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox(), frameRect = { x: 0, y: 0, ...page.viewportSize() };
  assert.ok(rect && frameRect);
  const left = Math.max(rect.x, frameRect.x), right = Math.min(rect.x + rect.width, frameRect.x + frameRect.width);
  const top = Math.max(rect.y, frameRect.y), bottom = Math.min(rect.y + rect.height, frameRect.y + frameRect.height);
  assert.ok(right - left > 180 && bottom - top > 140, 'A usable canvas area is actually visible');
  const x = left + (right - left) * .4, y = top + (bottom - top) * .55;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + Math.min(120, (right - left) * .24), y + 45, { steps: 12 });
  await page.mouse.up();
  await rendered('Pointer drag changes the actual WebGL rotation', state => !near(state.rotation, beforeDrag, .06));
  await views.getByRole('button', { name: 'Сбросить положение', exact: true }).click();
  await rendered('Reset restores the current camera', state => near(state.rotation, threeQuarter));
  await sceneShot('visual-weblg-desktop');
  checks.push(phase);

  phase = '390px-contained-preview';
  await page.setViewportSize({ width: 390, height: 844 });
  await poll('Preview is an actual 390px viewport', async () => await frame.evaluate(() => innerWidth) === 390);
  await rendered('390px canvas remains active');
  await picker.getByRole('button', { name: 'Триллион', exact: true }).click();
  await rendered('Scrollable mobile picker selects a cut');
  mobileMetrics = await frame.evaluate(() => {
    const picker = document.querySelector('#diamond-cuts-v5 .dc5-picker');
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      pickerWidth: picker.clientWidth, pickerScrollWidth: picker.scrollWidth, pickerScrollLeft: picker.scrollLeft, pickerOverflow: getComputedStyle(picker).overflowX };
  });
  assert.ok(mobileMetrics.documentWidth <= 391 && mobileMetrics.bodyWidth <= 391, `Preview document overflows horizontally: ${JSON.stringify(mobileMetrics)}`);
  assert.ok(mobileMetrics.pickerScrollWidth > mobileMetrics.pickerWidth && mobileMetrics.pickerScrollLeft > 0, 'Only the picker scrolls to reveal the last cut');
  assert.ok(['auto', 'scroll'].includes(mobileMetrics.pickerOverflow));
  await picker.getByRole('button', { name: 'Круглая', exact: true }).click();
  await rendered('Mobile round scene is ready');
  await sceneShot('visual-weblg-mobile-390');
  checks.push(phase);

  assert.deepEqual(errors, [], 'No uncaught JavaScript errors');
  assert.deepEqual(consoleErrors, [], 'No console errors');
  assert.deepEqual(cspErrors, [], 'No CSP violations');
  assert.deepEqual(external, [], 'No third-party network requests');
  assert.deepEqual(httpErrors, [], 'No failed browser HTTP responses');
  console.log(JSON.stringify({ ok: true, engine, softwareWebglOptIn: software, pack: `${ID}@${VERSION}`, title: TITLE, assets: 1, originalSha256: ORIGINAL_SHA, renderer, mobileMetrics, checks, screenshots: savedScreenshots, warnings }, null, 2));
} catch (error) {
  if (screenshots && page && !page.isClosed()) {
    try { await page.screenshot({ path: path.join(screenshots, 'visual-weblg-failure.png'), animations: 'allow', caret: 'initial' }); } catch (captureError) { warnings.push(`Failure screenshot: ${captureError.message}`); }
  }
  console.error(JSON.stringify({ ok: false, engine, softwareWebglOptIn: software, phase, message: error.message, lastGl, checks, errors, consoleErrors, warnings, cspErrors, external, httpErrors, previewRequests }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
