import assert from 'node:assert/strict';

// Only the browsing surface changes. Versioned API, raw files and ZIP hashes
// remain the source of truth for these assertions, never UI badges or copy.
export async function assertCatalogControls(page) {
  assert.equal(await page.locator('.version-select, .copy-context, .add-pack, .add-dialog, .howto-steps, .privacy-note, .pack-meta .version, .pack-summary').count(), 0, 'No version picker, pseudo-add flow, chat controls or filler summaries');
  assert.equal(await page.getByRole('combobox', { name: /Версия/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Контекст|Копировать запрос|Как добавить|^Добавить$|Запустить превью/ }).count(), 0);
  assert.equal(await page.locator('input[type="file"]').count(), 0, 'No fake upload UI');
  assert.ok(!/SHA-?256/i.test(await page.locator('.code-meta').allTextContents().then(values => values.join(' '))), 'Internal checksums are not UI badges');
}

export async function assertStableLinks(page) {
  const links = await page.locator('a[href^="#pack="]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  for (const href of links) {
    const params = new URLSearchParams(href.slice(1));
    assert.match(params.get('pack') || '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `Stable collection id without version: ${href}`);
    assert.equal(params.getAll('pack').length, 1);
    assert.ok([...params.keys()].every(key => ['pack', 'asset'].includes(key)));
    if (params.has('asset')) assert.match(params.get('asset'), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
}

export function assertLatestResourceRequests(urls, latest) {
  const current = new Map(latest.map(pack => [pack.id, pack]));
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    const versioned = pathname.match(/^\/(?:raw|previews)\/([a-z0-9-]+)\/([^/]+)\//);
    if (versioned) assert.equal(versioned[2], current.get(versioned[1])?.version, `Browser requested a non-current version: ${pathname}`);
    if (pathname.startsWith('/downloads/')) assert.ok(latest.some(pack => pack.downloadUrl === pathname), `Browser requested a non-current archive: ${pathname}`);
  }
}

export async function verifyLatestRouting({ page, base, catalog, latest, checks, skipped = [] }) {
  const pack = latest.find(candidate => catalog.packs.some(item => item.id === candidate.id && item.version !== candidate.version)) || latest[0];
  assert.ok(pack?.assets.length, 'Latest routing QA requires one real or disposable collection');
  const old = catalog.packs.find(item => item.id === pack.id && item.version !== pack.version);
  const legacyVersion = old?.version || '999.998.997';
  const key = `${pack.id}@${pack.version}`;
  const primary = pack.assets[0];
  const hashFor = asset => `#pack=${pack.id}${asset ? `&asset=${asset.id}` : ''}`;
  async function routeReady(asset) {
    await page.waitForFunction(hash => location.hash === hash, hashFor(asset));
    const scope = page.locator(asset ? '.asset-page' : '.collection-page');
    await scope.waitFor();
    assert.equal(await scope.getAttribute('data-pack'), key, 'Resolved content is always latest');
    if (asset) assert.equal(await scope.getAttribute('data-asset'), asset.id);
    assert.equal(await page.locator('.page-title').textContent(), asset?.title || pack.title);
    const download = page.locator('.workspace-heading').getByRole('link', { name: asset ? 'Скачать ассет' : 'Скачать коллекцию', exact: true });
    assert.equal(await download.getAttribute('href'), asset ? pack.files.find(file => file.path === asset.path).url : pack.downloadUrl, 'Download belongs to the displayed latest asset/collection');
    for (const src of await scope.locator('iframe').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')))) assert.ok(src.startsWith(`/previews/${pack.id}/${pack.version}/`), 'No transient historical preview');
    await assertCatalogControls(page);
    await assertStableLinks(page);
  }
  async function fresh(hash = '') {
    await page.goto('about:blank');
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
  }
  async function homeReady() {
    await page.waitForFunction(() => !location.hash);
    const card = page.locator(`.pack-card[data-pack="${key}"]`);
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    if (!pack.previewUrl || (pack.scripts && pack.autoplay !== true)) {
      assert.equal(await card.locator('iframe').count(), 0);
      return;
    }
    // Hash/history updates precede lazy iframe mounting. Do not immediately
    // leave a newly mounted root cover: Firefox reports that detached load as
    // NS_ERROR_FAILURE or an unknown error instead of a recognizable abort.
    // Verify actual preview readiness; keep the network-failure guard strict.
    const iframe = card.locator('.live-preview iframe');
    await iframe.waitFor();
    await card.locator('.preview-surface[data-preview-status="ready"]').waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame();
    assert.ok(frame, 'Root cover has an attached frame');
    await frame.waitForFunction(() => document.readyState === 'complete' && document.body?.childElementCount > 0);
    assert.equal(frame.url(), new URL(pack.previewUrl, base).href, 'Ready root cover uses the latest preview');
  }

  await fresh(`#pack=${pack.id}@${legacyVersion}`);
  await routeReady();
  await page.reload({ waitUntil: 'networkidle' });
  await routeReady();
  checks.push('stale-collection-link-and-reload-resolve-latest');

  const shared = old?.assets.find(asset => pack.assets.some(current => current.id === asset.id));
  if (shared) {
    const current = pack.assets.find(asset => asset.id === shared.id);
    await fresh(`#pack=${pack.id}@${old.version}&asset=${shared.id}`);
    await routeReady(current);
    await page.reload({ waitUntil: 'networkidle' });
    await routeReady(current);
    checks.push('legacy-shared-asset-resolves-latest');
  } else skipped.push('No shared historical asset id in this catalog; disposable fixtures cover legacy asset remapping.');

  const removed = old?.assets.find(asset => !pack.assets.some(current => current.id === asset.id));
  let missingId = removed?.id || 'qa-absent-asset';
  while (pack.assets.some(asset => asset.id === missingId)) missingId += '-absent';
  await fresh(`#pack=${pack.id}@${legacyVersion}&asset=${missingId}`);
  await routeReady();
  checks.push('legacy-missing-asset-opens-latest-collection');

  await fresh(`#pack=${pack.id}@999.998.997&asset=${primary.id}`);
  await routeReady(primary);
  checks.push('unpublished-version-link-resolves-latest');

  await fresh();
  await homeReady();
  const length = await page.evaluate(() => history.length);
  await page.evaluate(hash => { location.hash = hash; }, `pack=${pack.id}@${legacyVersion}`);
  await routeReady();
  assert.equal(await page.evaluate(() => history.length), length + 1, 'Canonicalization replaces the legacy hash instead of adding a history entry');
  await page.locator(`.asset-link[href="${hashFor(primary)}"]`).click();
  await routeReady(primary);
  await page.goBack(); await routeReady();
  await page.goBack(); await homeReady();
  await page.goForward(); await routeReady();
  await page.reload({ waitUntil: 'networkidle' }); await routeReady();
  checks.push('back-forward-and-reload-never-restore-old-content');

  await page.getByRole('navigation', { name: 'Библиотека', exact: true }).getByRole('link', { name: /^Все коллекции/ }).click();
  await homeReady();
}
