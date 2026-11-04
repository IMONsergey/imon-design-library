// Isolated headless QA: no existing browser or user profile is used.
// PLAYWRIGHT_MODULE=/opt/imon-agent/node_modules/playwright/index.mjs \
// CHROME_BIN=/opt/google/chrome/chrome SCREENSHOTS_DIR=/tmp/imon-library-qa \
// node tests/browser-smoke.mjs
// BROWSER_ENGINE=firefox|webkit; optional FIREFOX_BIN or WEBKIT_BIN.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { verifyEmptyCatalog } from './browser-empty-checks.mjs';

const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), 'BROWSER_ENGINE must be chromium, firefox or webkit');
const executablePath = { chromium: process.env.CHROME_BIN, firefox: process.env.FIREFOX_BIN, webkit: process.env.WEBKIT_BIN }[engine];
const screenshots = process.env.SCREENSHOTS_DIR ? path.resolve(process.env.SCREENSHOTS_DIR) : null;
if (screenshots) await mkdir(screenshots, { recursive: true });
const categoryLabels = new Map([['design-system', 'Дизайн-системы'], ['components', 'Компоненты'], ['motion', 'Движение'], ['icons', 'Иконки'], ['typography', 'Типографика'], ['guidelines', 'Правила'], ['templates', 'Шаблоны']]);
const errors = [], consoleErrors = [], cspErrors = [], external = [], httpErrors = [], requestFailures = [], checks = [], screenshotFiles = [], skipped = [];
const keyOf = pack => `${pack.id}@${pack.version}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru');
const byVersion = (a, b) => { const aa = a.version.split('.').map(Number), bb = b.version.split('.').map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i]; return 0; };
let server, browser, context, page, base, origin, phase = 'startup';

async function poll(label, callback, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await callback()) return; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`${label}${lastError ? `: ${lastError.message}` : ''}`);
}
async function settle() {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
const cards = () => page.locator('.catalog-results:visible .pack-card');
const card = pack => cards().filter({ has: page.locator(`.pack-link[href="#pack=${keyOf(pack)}"]`) });
const dialog = () => page.locator('.pack-detail');
const search = () => page.getByRole('textbox', { name: 'Поиск по библиотеке', exact: true });
async function waitCards(packs) {
  const expected = packs.map(keyOf);
  await poll(`Visible pack order should be ${expected.join(', ') || '(empty)'}`, async () => JSON.stringify(await cards().evaluateAll(nodes => nodes.map(node => node.dataset.pack))) === JSON.stringify(expected));
}
async function waitRoute(pack = null) {
  await page.waitForFunction(expected => (new URLSearchParams(location.hash.slice(1)).get('pack') || '') === expected, pack ? keyOf(pack) : '');
}
async function shot(name, fullPage = false) {
  if (!screenshots) return;
  await settle();
  await page.mouse.move(0, 0);
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(screenshots, filename), fullPage, animations: 'disabled' });
  screenshotFiles.push(filename);
}
async function noOverflow(label) {
  await settle();
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth, scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].map(node => { const rect = node.getBoundingClientRect(); return { name: node.id || (typeof node.className === 'string' ? node.className : node.tagName), x: rect.x, right: rect.right, width: rect.width }; }).filter(item => item.width > 0 && (item.right > innerWidth + 1 || item.x < -1)).slice(0, 18),
  }));
  assert.ok(metrics.scroll <= metrics.viewport + 1, `${label}: page horizontal overflow ${JSON.stringify(metrics)}`);
}
async function dialogFits(label) {
  const rect = await dialog().boundingBox();
  const viewport = page.viewportSize();
  assert.ok(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, `${label}: dialog must fit viewport; ${JSON.stringify({ rect, viewport })}`);
  await noOverflow(label);
}
async function activeTabLinked(list) {
  const active = list.getByRole('tab', { selected: true });
  assert.equal(await active.count(), 1, 'Exactly one tab is selected');
  const info = await active.evaluate(node => {
    const panel = document.getElementById(node.getAttribute('aria-controls') || '');
    return { tabId: node.id, target: node.getAttribute('aria-controls'), role: panel?.getAttribute('role'), label: panel?.getAttribute('aria-labelledby'), visible: !!panel?.getClientRects().length };
  });
  assert.ok(info.tabId && info.target && info.visible && info.role === 'tabpanel' && info.label?.split(/\s+/).includes(info.tabId), `Active tab must label a real visible panel: ${JSON.stringify(info)}`);
}
async function appearance(value) {
  await poll(`Theme should resolve to ${value}`, () => page.evaluate(expected => document.documentElement.dataset.theme === expected && document.querySelector('.library-theme')?.dataset.appearance === expected, value));
  const colors = await page.locator('.library-theme').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, font: getComputedStyle(node).fontFamily }));
  assert.equal(colors.background, value === 'dark' ? 'rgb(17, 17, 17)' : 'rgb(250, 250, 250)', 'Actual theme background matches appearance');
  assert.match(colors.font, /Inter/, 'Catalog uses the self-hosted Inter family');
}
async function chooseTheme(value) {
  const names = { light: 'Светлая тема', dark: 'Темная тема', system: 'Системная тема' };
  const trigger = page.locator('.theme-switch').getByLabel(names[value], { exact: true });
  await trigger.click();
  await poll(`Theme preference ${value} should be selected`, async () => await trigger.getAttribute('data-state') === 'on');
  assert.equal(await page.evaluate(() => localStorage.getItem('imon-library-theme')), value, 'Theme preference persists');
  if (value !== 'system') await appearance(value);
}
async function selectSort(name) {
  await page.getByRole('combobox', { name: 'Сортировка паков', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
async function openPack(pack) {
  await card(pack).locator('.pack-link').click();
  await dialog().waitFor({ state: 'visible' });
  await waitRoute(pack);
  assert.equal(await dialog().getAttribute('role'), 'dialog');
  assert.equal(await dialog().locator('.detail-title').textContent(), pack.title);
  const labeling = await dialog().evaluate(node => ({ name: document.getElementById(node.getAttribute('aria-labelledby'))?.textContent, description: document.getElementById(node.getAttribute('aria-describedby'))?.textContent, hidden: !!node.closest('[aria-hidden="true"]') }));
  assert.ok(labeling.name?.trim() && labeling.description?.trim() && !labeling.hidden, 'Dialog has a real accessible title/description and is not aria-hidden');
  await activeTabLinked(dialog().getByRole('tablist', { name: 'Содержание пака' }));
}
async function closePackWithEscape(pack) {
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  await waitRoute();
  await poll('Closing the dialog returns focus to its pack link', () => card(pack).locator('.pack-link').evaluate(node => document.activeElement === node));
}
async function verifyFrame(locator, pack, expectedSandbox = pack.scripts ? 'allow-scripts' : '') {
  assert.equal(await locator.getAttribute('sandbox'), expectedSandbox, 'Only documented sandbox capabilities are granted');
  assert.equal(await locator.getAttribute('referrerpolicy'), 'no-referrer');
  const handle = await locator.elementHandle();
  const frame = await handle.contentFrame();
  assert.ok(frame, 'Preview iframe has a browsing context');
  await poll('Preview should load its own pack document', async () => new URL(frame.url()).pathname === pack.previewUrl && !!(await frame.locator('body').textContent())?.trim());
  assert.equal(await frame.evaluate(() => { try { return parent.document.body ? 'accessible' : 'unexpected'; } catch { return 'isolated'; } }), 'isolated', 'Preview cannot access catalog DOM');
  await handle.dispose();
}
async function textFile(pack) {
  const file = pack.files.find(item => /\.(?:css|m?js|json|html?|md|txt|svg)$/i.test(item.path) && item.size <= 524288);
  assert.ok(file, `${pack.id} must provide a small text file for the real-code smoke test`);
  await dialog().getByRole('tab', { name: 'Файлы и код', exact: true }).click();
  await dialog().getByTitle(file.path, { exact: true }).click();
  await dialog().locator('.code-source code').waitFor({ state: 'visible' });
  await poll('Code copy button should be enabled', () => dialog().getByRole('button', { name: 'Копировать', exact: true }).isEnabled());
  assert.equal(await dialog().locator('.code-filename').textContent(), file.path);
  return file;
}
async function downloadFrom(link) {
  const waiting = page.waitForEvent('download');
  await link.click();
  const download = await waiting;
  const stream = await download.createReadStream();
  assert.ok(stream, 'Browser download has a readable body');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(await download.failure(), null, 'Browser completed the download');
  return { filename: download.suggestedFilename(), body: Buffer.concat(chunks) };
}

try {
  base = process.env.LIBRARY_URL;
  if (!base) {
    server = createStaticServer(path.resolve('dist'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  base = new URL('/', base).href.replace(/\/$/, '');
  origin = new URL(base).origin;
  browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', locale: 'ru-RU', acceptDownloads: true });
  if (engine === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  else skipped.push(`Clipboard permission/content assertions are Chromium-only; engine=${engine}`);
  await context.exposeBinding('__imonQaCsp', ({ frame }, violation) => cspErrors.push({ frame: frame.url(), ...violation }));
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', event => { globalThis.__imonQaCsp({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition, source: event.sourceFile, line: event.lineNumber }).catch(() => {}); }));
  context.on('page', opened => {
    opened.on('pageerror', error => errors.push({ url: opened.url(), message: error.message }));
    opened.on('console', message => { if (message.type() === 'error') consoleErrors.push({ url: opened.url(), message: message.text(), location: message.location() }); });
  });
  context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url()); });
  context.on('response', response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
  context.on('requestfailed', request => requestFailures.push({ url: request.url(), type: request.resourceType(), error: request.failure()?.errorText }));
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(30000);

  phase = 'catalog-and-nonce';
  const navigation = await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(navigation.status(), 200);
  const catalogResponse = await context.request.get('/api/catalog.json');
  assert.equal(catalogResponse.status(), 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(Array.isArray(catalog.packs), 'Catalog has a real packs array');
  const grouped = new Map();
  for (const pack of [...catalog.packs].sort(byVersion)) if (!grouped.has(pack.id)) grouped.set(pack.id, pack);
  const latest = [...grouped.values()].sort(byTitle);
  const totalAssets = latest.reduce((total, pack) => total + pack.assets.length, 0);
  const viewports = [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }];
  if (latest.length === 0) {
    phase = 'empty-library';
    await verifyEmptyCatalog({ page, context, navigation, engine, chooseTheme, appearance, shot, noOverflow, checks, viewports, activeTabLinked, poll, settle });
    skipped.push('The published library is intentionally empty. Populated pack workflows are exercised only by isolated fixtures.');
  } else {
  const primary = latest.find(pack => pack.id === 'interface-foundation') || latest[0];
  await waitCards(latest);
  assert.equal(Number(await page.locator('.heading-count').innerText()), latest.length, 'Heading counts real latest-version data');
  await activeTabLinked(page.getByRole('tablist', { name: 'Коллекция' }));
  const requestNonce = await page.locator('meta[name="csp-nonce"]').getAttribute('content');
  assert.match(requestNonce, /^[A-Za-z0-9+/]{20,}={0,2}$/, 'HTML contains a real request nonce');
  const navigationCsp = navigation.headers()['content-security-policy'] || '';
  assert.ok(navigationCsp.includes(`'nonce-${requestNonce}'`), 'Response CSP contains exactly this document nonce');
  assert.match(navigationCsp, /script-src 'self'(?:;|$)/);
  assert.ok(!navigationCsp.includes('unsafe-eval'), 'Catalog does not enable unsafe eval');
  assert.equal(navigation.headers()['cache-control'], 'no-store');
  const freshDocument = await context.request.get('/');
  const freshNonce = (await freshDocument.text()).match(/<meta\s+name="csp-nonce"\s+content="([^"]+)"/i)?.[1];
  assert.ok(freshNonce && freshNonce !== requestNonce, 'Another HTTP response receives another nonce');
  await settle();
  assert.ok(await page.evaluate(() => [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'Inter Variable' && face.status === 'loaded')), 'Inter font actually loaded, not only a fallback declaration');
  for (const pack of latest.filter(item => !item.scripts)) {
    await card(pack).scrollIntoViewIfNeeded();
    await verifyFrame(card(pack).locator('iframe'), pack, '');
    const response = await context.request.get(pack.previewUrl);
    const csp = response.headers()['content-security-policy'] || '';
    assert.match(csp, /sandbox/);
    assert.ok(!csp.includes('allow-same-origin'), 'Preview HTTP sandbox also excludes same-origin');
    for (const directive of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(csp.includes(directive), `Preview enforces ${directive}`);
  }
  for (const pack of latest.filter(item => item.scripts)) assert.equal(await card(pack).locator('iframe').count(), 0, 'Script pack never auto-runs in its catalog cover');
  await page.evaluate(() => scrollTo(0, 0));
  await noOverflow(phase);
  checks.push(phase);

  phase = 'appearance-and-persistence';
  await appearance('light');
  await chooseTheme('dark');
  await page.reload({ waitUntil: 'networkidle' });
  await waitCards(latest);
  await appearance('dark');
  assert.equal(await page.locator('.theme-switch').getByLabel('Темная тема', { exact: true }).getAttribute('data-state'), 'on');
  await chooseTheme('light');
  await chooseTheme('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await appearance('dark');
  await page.reload({ waitUntil: 'networkidle' });
  await waitCards(latest);
  await appearance('dark');
  assert.equal(await page.locator('.theme-switch').getByLabel('Системная тема', { exact: true }).getAttribute('data-state'), 'on');
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance('light');
  await chooseTheme('light');
  checks.push(phase);

  phase = 'search-empty-and-reset';
  await page.locator('.brand').focus();
  await page.keyboard.press('/');
  assert.ok(await search().evaluate(node => document.activeElement === node), 'Slash focuses the real search field');
  await search().fill(primary.id);
  await waitCards([primary]);
  await search().fill('zzzz-no-matching-library-asset');
  await waitCards([]);
  assert.equal(await page.locator('.empty-state h2').innerText(), 'Ничего не нашлось');
  await shot('empty-state-light');
  await page.getByRole('button', { name: 'Сбросить поиск', exact: true }).click();
  await waitCards(latest);
  assert.equal(await search().inputValue(), '');
  checks.push(phase);

  phase = 'filters-and-sorting';
  const filterPack = latest.find(pack => pack.tags.length && categoryLabels.has(pack.category));
  assert.ok(filterPack, 'Real category/tag metadata is required for filter QA');
  const categoryPacks = latest.filter(pack => pack.category === filterPack.category);
  const tagName = [...new Set(categoryPacks.flatMap(pack => pack.tags))].sort((a, b) => a.localeCompare(b, 'ru'))[0];
  await page.locator('.filter-button').click();
  await page.locator('.filter-popover').waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: 'Категория', exact: true }).click();
  await page.getByRole('option', { name: `${categoryLabels.get(filterPack.category)} · ${categoryPacks.length}`, exact: true }).click();
  await waitCards(categoryPacks);
  await page.locator('.filter-popover').getByRole('button', { name: tagName, exact: true }).click();
  await waitCards(categoryPacks.filter(pack => pack.tags.includes(tagName)));
  assert.equal(await page.locator('.filter-count').textContent(), '2');
  await page.keyboard.press('Escape');
  await page.locator('.filter-popover').waitFor({ state: 'hidden' });
  assert.ok(await page.locator('.filter-button').evaluate(node => document.activeElement === node), 'Closing the filter popover restores trigger focus');
  await page.locator('.active-filters').getByRole('button', { name: 'Сбросить', exact: true }).click();
  await waitCards(latest);
  await selectSort('По числу ассетов');
  await waitCards([...latest].sort((a, b) => b.assets.length - a.assets.length || byTitle(a, b)));
  await selectSort('По категории');
  await waitCards([...latest].sort((a, b) => (categoryLabels.get(a.category) || 'Материалы').localeCompare(categoryLabels.get(b.category) || 'Материалы', 'ru') || byTitle(a, b)));
  await selectSort('По названию');
  await waitCards(latest);
  checks.push(phase);

  phase = 'views-and-favorites-persistence';
  await page.locator('.view-switch').getByLabel('Список', { exact: true }).click();
  await page.locator('.pack-list').waitFor({ state: 'visible' });
  await noOverflow('desktop-list');
  await page.reload({ waitUntil: 'networkidle' });
  await waitCards(latest);
  assert.equal(await page.locator('.pack-list').count(), 1, 'List view persists after reload');
  await page.locator('.view-switch').getByLabel('Плитка', { exact: true }).click();
  await page.locator('.pack-grid').waitFor({ state: 'visible' });
  await card(primary).locator('.bookmark').click();
  assert.equal(await card(primary).locator('.bookmark').getAttribute('aria-pressed'), 'true');
  assert.equal(await dialog().count(), 0, 'Bookmark is not an accidental pack-open click');
  await page.getByRole('tab', { name: /^Избранное/ }).click();
  await waitCards([primary]);
  await activeTabLinked(page.getByRole('tablist', { name: 'Коллекция' }));
  await page.reload({ waitUntil: 'networkidle' });
  await waitCards(latest);
  assert.equal(await card(primary).locator('.bookmark').getAttribute('aria-pressed'), 'true', 'Favorite survives reload');
  await page.getByRole('tab', { name: /^Избранное/ }).click();
  await waitCards([primary]);
  await page.getByRole('tab', { name: /^Все паки/ }).click();
  await waitCards(latest);
  checks.push(phase);

  phase = 'dialog-files-downloads-and-focus';
  await openPack(primary);
  await poll('Dialog opens with title focus', () => dialog().locator('.detail-title').evaluate(node => document.activeElement === node));
  const inlineStyles = await page.locator('style').evaluateAll(nodes => nodes.map(node => ({ nonce: node.nonce, size: node.textContent.length })));
  const activeNonce = await page.locator('meta[name="csp-nonce"]').getAttribute('content');
  assert.ok(inlineStyles.some(item => item.size > 0), 'Radix injected its real focus/scroll styles');
  assert.ok(inlineStyles.every(item => item.nonce === activeNonce), 'Every dynamically inserted catalog style carries the active CSP nonce');
  if (primary.scripts) { assert.equal(await dialog().locator('.detail-frame').count(), 0); await dialog().getByRole('button', { name: 'Запустить превью' }).click(); }
  await verifyFrame(dialog().locator('.detail-frame'), primary);
  await dialog().getByLabel('Мобильное превью', { exact: true }).click();
  assert.equal(await dialog().locator('.preview-canvas').getAttribute('data-width'), 'mobile');
  assert.ok(Math.abs((await dialog().locator('.detail-frame').boundingBox()).width - 390) <= 1, '390px preview is an actual 390px viewport');
  await dialog().getByLabel('Широкое превью', { exact: true }).click();
  const file = await textFile(primary);
  const rawResponse = await context.request.get(file.url);
  assert.equal(rawResponse.status(), 200);
  assert.match(rawResponse.headers()['content-type'], /^text\/plain/);
  assert.match(rawResponse.headers()['content-disposition'], /attachment/);
  const expectedText = await rawResponse.text();
  assert.equal(await dialog().locator('.code-source code').textContent(), expectedText, 'The displayed code is the actual exported file, not sample text');
  assert.equal(await dialog().locator('.code-lines').getAttribute('aria-hidden'), 'true');
  const numbers = (await dialog().locator('.code-lines').textContent()).split('\n');
  assert.equal(numbers.length, Math.min(expectedText.split('\n').length, 10000));
  assert.equal(numbers[0], '1');
  const gutterRect = await dialog().locator('.code-lines').boundingBox(), sourceRect = await dialog().locator('.code-source').boundingBox();
  assert.ok(sourceRect.x >= gutterRect.x + gutterRect.width - 1, 'Line numbers and source code are side by side');
  assert.equal(await dialog().locator('.code-meta [title]').getAttribute('title'), file.sha256);
  if (engine === 'chromium') {
    await dialog().getByRole('button', { name: 'Копировать', exact: true }).click();
    await poll('File copy should match the actual file SHA-256', async () => digest(await page.evaluate(() => navigator.clipboard.readText())) === file.sha256);
    await dialog().getByRole('button', { name: 'Контекст для чата', exact: true }).click();
    await poll('Chat context includes exact pack/version/license/source', async () => { const value = await page.evaluate(() => navigator.clipboard.readText()); return value.includes(`Пак: ${primary.id}`) && value.includes(`Версия: ${primary.version}`) && value.includes(`packs/${primary.id}/${primary.version}/`) && value.includes(primary.license.id); });
  }
  const downloadedFile = await downloadFrom(dialog().getByRole('link', { name: 'Скачать файл', exact: true }));
  assert.equal(downloadedFile.filename, file.path.split('/').at(-1));
  assert.equal(digest(downloadedFile.body), file.sha256, 'Raw browser download matches published checksum');
  const zip = await downloadFrom(dialog().getByRole('link', { name: /^Скачать пак/ }));
  assert.equal(zip.filename, `${primary.id}-${primary.version}.zip`);
  assert.equal(zip.body.readUInt32LE(0), 0x04034b50, 'The downloaded artifact is a real ZIP');
  assert.equal(zip.body.length, primary.downloadSize);
  assert.equal(digest(zip.body), primary.downloadSha256);
  await dialog().getByRole('tab', { name: 'Файлы и код', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await poll('ArrowRight activates the rules tab', async () => await dialog().getByRole('tab', { name: 'Правила', exact: true }).getAttribute('aria-selected') === 'true');
  await activeTabLinked(dialog().getByRole('tablist', { name: 'Содержание пака' }));
  assert.equal(await dialog().locator('.guide-asset').count(), primary.assets.length);
  assert.ok((await dialog().locator('.guide-aside').textContent()).includes(primary.license.id));
  await dialog().getByRole('button', { name: 'Контекст для чата', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.ok(await dialog().evaluate(node => node.contains(document.activeElement)), 'Tab cannot escape the modal');
  await dialog().getByRole('combobox', { name: 'Версия пака', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await dialog().evaluate(node => node.contains(document.activeElement)), 'Shift+Tab cannot escape the modal');
  const historyBeforeVersions = await page.evaluate(() => history.length);
  const otherVersion = catalog.packs.find(pack => pack.id === primary.id && pack.version !== primary.version);
  await dialog().getByRole('combobox', { name: 'Версия пака', exact: true }).click();
  await page.getByRole('option', { name: `v${otherVersion?.version || primary.version}`, exact: true }).click();
  if (otherVersion) {
    await waitRoute(otherVersion);
    if (!otherVersion.scripts) await verifyFrame(dialog().locator('.detail-frame'), otherVersion);
    await dialog().getByRole('combobox', { name: 'Версия пака', exact: true }).click();
    await page.getByRole('option', { name: `v${primary.version}`, exact: true }).click();
    await waitRoute(primary);
    if (!primary.scripts) await verifyFrame(dialog().locator('.detail-frame'), primary);
    assert.equal(await page.evaluate(() => history.length), historyBeforeVersions, 'Version previews must not add iframe entries to browser history');
  }
  else skipped.push('Multi-version switching: the real catalog currently has one version of the primary pack; selector opening/selection still tested');
  await closePackWithEscape(primary);
  checks.push(phase);

  phase = 'hash-history-and-deep-links';
  await openPack(primary);
  await page.goBack();
  await dialog().waitFor({ state: 'hidden' });
  await waitRoute();
  await page.goForward();
  await dialog().waitFor({ state: 'visible' });
  await waitRoute(primary);
  await closePackWithEscape(primary);
  // Leave the document first: hash-only goto has no fresh load lifecycle in
  // Firefox, and would also preserve React refs instead of testing a deep link.
  await page.goto('about:blank');
  await page.goto(`${base}/#pack=${keyOf(primary)}`, { waitUntil: 'networkidle' });
  await dialog().waitFor({ state: 'visible' });
  await waitRoute(primary);
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  await waitRoute();
  assert.equal(new URL(page.url()).origin, origin, 'Closing a direct deep link does not leave the library');
  await poll('Direct-link close returns focus to search', () => search().evaluate(node => document.activeElement === node));
  await page.evaluate(() => { location.hash = 'pack=missing-library-pack@9.9.9'; });
  await waitRoute();
  assert.equal(await dialog().count(), 0);
  await page.getByText('Эта версия пака не найдена', { exact: true }).waitFor({ state: 'visible' });
  checks.push(phase);

  phase = 'script-preview-gates';
  for (const pack of latest.filter(item => item.scripts)) {
    await openPack(pack);
    assert.equal(await dialog().locator('.detail-frame').count(), 0, 'JavaScript preview awaits explicit launch');
    await dialog().getByRole('button', { name: 'Запустить превью', exact: true }).click();
    await verifyFrame(dialog().locator('.detail-frame'), pack, 'allow-scripts');
    await closePackWithEscape(pack);
    await openPack(pack);
    assert.equal(await dialog().locator('.detail-frame').count(), 0, 'Reopening a script pack requires explicit launch again');
    await closePackWithEscape(pack);
  }
  if (!latest.some(pack => pack.scripts)) skipped.push('JavaScript launch gate: no published scripts=true pack in the real catalog; static sandbox behavior was verified');
  checks.push(phase);

  phase = 'add-dialog';
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.locator('.add-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.howto-steps li').count(), 3);
  assert.match(await page.locator('.privacy-note').textContent(), /публичные/);
  if (engine === 'chromium') { await page.getByRole('button', { name: 'Копировать запрос', exact: true }).click(); await poll('The real add-pack prompt is copied', async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('docs/ADDING_ASSETS.md')); }
  await shot('add-light-1440');
  await page.keyboard.press('Escape');
  await page.locator('.add-dialog').waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: 'Добавить', exact: true }).evaluate(node => document.activeElement === node), 'Add dialog restores trigger focus');
  checks.push(phase);

  for (const theme of ['light', 'dark']) {
    await chooseTheme(theme);
    for (const viewport of viewports) {
      phase = `responsive-${theme}-${viewport.width}`;
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      await settle();
      await noOverflow(`${phase}-catalog`);
      await shot(`catalog-${theme}-${viewport.width}`, true);
      await selectSort('По числу ассетов');
      await noOverflow(`${phase}-long-sort-label`);
      await selectSort('По названию');
      await page.locator('.view-switch').getByLabel('Список', { exact: true }).click();
      await page.locator('.pack-list').waitFor({ state: 'visible' });
      await noOverflow(`${phase}-list`);
      if (viewport.width === 1440) await shot(`list-${theme}-1440`, true);
      await page.locator('.view-switch').getByLabel('Плитка', { exact: true }).click();
      await page.locator('.pack-grid').waitFor({ state: 'visible' });
      await openPack(primary);
      await dialogFits(`${phase}-preview`);
      const portalTheme = await dialog().evaluate(node => { const host = node.closest('.radix-themes'); return { dark: host?.classList.contains('dark'), background: getComputedStyle(node).backgroundColor, font: getComputedStyle(node).fontFamily }; });
      assert.equal(portalTheme.dark, theme === 'dark', 'Radix portal inherits the selected appearance');
      assert.equal(portalTheme.background, theme === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)', 'Dialog has the correct actual themed surface');
      assert.match(portalTheme.font, /Inter/);
      if (primary.scripts) await dialog().getByRole('button', { name: 'Запустить превью' }).click();
      await verifyFrame(dialog().locator('.detail-frame'), primary);
      await shot(`pack-${theme}-${viewport.width}`);
      await dialog().getByLabel('Мобильное превью', { exact: true }).click();
      await noOverflow(`${phase}-390-preview-contained`);
      assert.ok(Math.abs((await dialog().locator('.detail-frame').boundingBox()).width - 390) <= 1, '390px preview retains its width even on narrower screens');
      await textFile(primary);
      await dialogFits(`${phase}-files`);
      await shot(`files-${theme}-${viewport.width}`);
      await dialog().getByRole('tab', { name: 'Правила', exact: true }).click();
      await dialogFits(`${phase}-guide`);
      if (viewport.width === 1440 || viewport.width === 390) await shot(`guide-${theme}-${viewport.width}`);
      await closePackWithEscape(primary);
      if (viewport.width === 320) {
        await page.locator('.filter-button').click();
        await page.locator('.filter-popover').waitFor({ state: 'visible' });
        await noOverflow(`${phase}-filters`);
        await shot(`filters-${theme}-320`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Добавить', exact: true }).click();
        await page.locator('.add-dialog').waitFor({ state: 'visible' });
        await noOverflow(`${phase}-add`);
        await shot(`add-${theme}-320`);
        await page.keyboard.press('Escape');
        await page.locator('.add-dialog').waitFor({ state: 'hidden' });
      }
      checks.push(phase);
    }
  }

  }
  phase = 'runtime-and-security-errors';
  await settle();
  const unexpectedFailures = requestFailures.filter(item => !/(?:ERR_ABORTED|NS_BINDING_ABORTED|AbortError|cancelled|canceled)/i.test(item.error || ''));
  assert.deepEqual(errors, [], 'No uncaught JavaScript errors in any tested page');
  assert.deepEqual(cspErrors, [], 'No CSP violations from the catalog or its previews');
  assert.deepEqual(consoleErrors, [], 'No browser console errors');
  assert.deepEqual(httpErrors, [], 'No failed HTTP responses');
  assert.deepEqual(unexpectedFailures, [], 'No unexpected failed network requests');
  assert.deepEqual(external, [], 'Catalog and previews make no third-party requests');
  checks.push(phase);
  console.log(JSON.stringify({ ok: true, engine, base, packs: latest.length, assets: totalAssets, themes: ['light', 'dark', 'system'], viewports, checks, skipped, screenshots: screenshotFiles, errors, cspErrors, external }, null, 2));
} catch (error) {
  if (screenshots && page && !page.isClosed()) { try { await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true, animations: 'disabled' }); } catch (captureError) { console.error(`Failure screenshot unavailable: ${captureError.message}`); } }
  console.error(JSON.stringify({ ok: false, engine, phase, message: error.message, checks, errors, consoleErrors, cspErrors, httpErrors, requestFailures, external, screenshot: screenshots ? path.join(screenshots, 'failure.png') : null }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
