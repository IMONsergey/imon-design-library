import assert from 'node:assert/strict';

// Public empty catalogs are intentional. Never populate them just to pass QA.
export async function verifyEmptyCatalog({ page, context, navigation, engine, chooseTheme, appearance, shot, noOverflow, checks, viewports, poll, settle }) {
  const empty = page.getByRole('heading', { name: 'Пока нет коллекций', exact: true });
  const add = () => page.getByRole('button', { name: 'Как добавить', exact: true });
  const nav = page.getByRole('navigation', { name: 'Библиотека', exact: true });
  const all = nav.getByRole('link', { name: /^Все коллекции/ });
  const favorites = nav.getByRole('link', { name: /^Избранное/ });
  await empty.waitFor();
  assert.equal(await page.locator('.pack-card, iframe, .sidebar-folders').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Поиск по библиотеке' }).count(), 0, 'Do not show a nonfunctional search over an empty library');
  assert.equal(await page.locator('.filter-button, .sort-select, .view-switch').count(), 0);
  assert.equal(await add().count(), 1, 'One useful action, not repeated add buttons');
  assert.equal(await page.locator('.brand-wordmark').count(), 0, 'No typeset replacement for the logo');
  const logo = page.locator('.brand-logo');
  assert.equal(await logo.getAttribute('viewBox'), '0 0 1496 481');
  assert.ok((await logo.locator('path').getAttribute('d')).startsWith('M1495.1 0H0V480.311H1495.1V0Z'), 'Use the original official logo geometry');
  assert.equal(await all.getAttribute('aria-current'), 'page');
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
  assert.equal(await page.locator('.pack-detail').count(), 0, 'There is no collection modal');
  const nonce = await page.locator('meta[name="csp-nonce"]').getAttribute('content');
  assert.match(nonce, /^[A-Za-z0-9+/]{20,}={0,2}$/);
  const csp = navigation.headers()['content-security-policy'] || '';
  assert.ok(csp.includes(`'nonce-${nonce}'`));
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.ok(!csp.includes('unsafe-eval'));
  assert.equal(navigation.headers()['cache-control'], 'no-store');
  const next = await context.request.get('/');
  const nextNonce = (await next.text()).match(/<meta\s+name="csp-nonce"\s+content="([^"]+)"/i)?.[1];
  assert.ok(nextNonce && nextNonce !== nonce);
  const health = await (await context.request.get('/health.json')).json();
  assert.equal(health.packVersions, 0);
  assert.equal(health.assets, 0);
  for (const id of ['interface-foundation', 'layout-recipes', 'motion-essentials']) {
    for (const route of [`/api/packs/${id}/1.0.0.json`, `/previews/${id}/1.0.0/preview/index.html`, `/raw/${id}/1.0.0/README.md`, `/downloads/${id}-1.0.0.zip`]) {
      assert.equal((await context.request.get(route)).status(), 404, `Withdrawn content is not served: ${route}`);
    }
  }
  checks.push('empty-library-and-withdrawn-content', 'official-svg-and-nonce');

  await chooseTheme('dark');
  await page.reload({ waitUntil: 'networkidle' });
  await empty.waitFor();
  await appearance('dark');
  await chooseTheme('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await appearance('dark');
  await page.reload({ waitUntil: 'networkidle' });
  await empty.waitFor();
  await appearance('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance('light');
  checks.push('empty-theme-persistence');

  await favorites.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Нет сохраненных коллекций', exact: true }).waitFor();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('view'), 'favorites');
  assert.equal(await favorites.getAttribute('aria-current'), 'page');
  await poll('Keyboard navigation focuses the page title', () => page.locator('.page-title').evaluate(node => document.activeElement === node));
  assert.equal(await page.getByRole('heading', { name: 'Ничего не нашлось', exact: true }).count(), 0);
  await all.click();
  await empty.waitFor();
  checks.push('separate-empty-favorites-and-keyboard-navigation');

  for (const theme of ['light', 'dark']) {
    await chooseTheme(theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await settle();
      assert.equal(await all.getAttribute('aria-current'), 'page');
      assert.ok(await all.isVisible() && await favorites.isVisible(), 'Sidebar links remain usable at this viewport');
      await noOverflow(`empty-${theme}-${viewport.width}`);
      const logoBox = await logo.boundingBox();
      assert.ok(logoBox && logoBox.width > 50 && Math.abs(logoBox.width / logoBox.height - 1496 / 481) < 0.02, 'Official logo proportions are preserved');
      await shot(`catalog-${theme}-${viewport.width}`, true);
      await add().click();
      const dialog = page.locator('.add-dialog');
      await page.getByRole('heading', { name: 'Добавление через чат', exact: true }).waitFor();
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `Instruction dialog fits ${viewport.width}`);
      assert.equal(await page.locator('input[type="file"]').count(), 0, 'No fake upload UI');
      assert.match(await dialog.locator('.privacy-note').innerText(), /публичные/);
      if (engine === 'chromium' && viewport.width === 1440) {
        await dialog.getByRole('button', { name: 'Копировать запрос', exact: true }).click();
        await poll('Copied prompt identifies the actual repository', async () => (await page.evaluate(() => navigator.clipboard.readText())).includes('IMONsergey/imon-design-library'));
      }
      await noOverflow(`instruction-${theme}-${viewport.width}`);
      await shot(`add-${theme}-${viewport.width}`);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await add().evaluate(node => node === document.activeElement), 'Closing the instruction restores its trigger focus');
      checks.push(`empty-${theme}-${viewport.width}`);
    }
  }
  await page.goto('about:blank');
  await page.goto(new URL('/#pack=interface-foundation@1.0.0', navigation.url()).href, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Страница не найдена', exact: true }).waitFor();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('pack'), 'interface-foundation@1.0.0', 'Missing routes remain explicit, not silently replaced');
  assert.equal(await page.locator('.collection-page, .asset-page, .pack-detail, iframe').count(), 0);
  await all.click();
  await empty.waitFor();
  await poll('All collections link returns to the root', () => !new URL(page.url()).hash);
  checks.push('withdrawn-deep-link');
}
