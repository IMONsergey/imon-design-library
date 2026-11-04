// Populated catalog QA without adding any content to the real library.
// Run npm run build first, then use the same browser/screenshot environment as
// tests/browser-smoke.mjs. LIBRARY_URL is never forwarded to the child process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createCatalogFixture } from './helpers/catalog-fixture.mjs';
import { createDraft } from '../scripts/new-pack.mjs';
import { buildLibrary } from '../scripts/build.mjs';
import { validateUiOutputs } from '../scripts/build-ui.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const uiNames = ['index.html', 'app.js', 'app.css', 'theme-init.js', 'favicon.svg', 'third-party-notices.txt'];

function readTrustedUi() {
  const directory = path.join(projectRoot, 'dist');
  assert.equal(fs.realpathSync(directory), directory, 'Build the project UI into its real dist directory first');
  const fontDirectory = path.join(directory, 'ui-assets');
  assert.equal(fs.realpathSync(fontDirectory), fontDirectory, 'UI fonts must come from the trusted build directory');
  const names = [...uiNames];
  for (const entry of fs.readdirSync(fontDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    assert.ok(entry.isFile() && !entry.isSymbolicLink() && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.woff2$/.test(entry.name), `Unexpected UI asset: ${entry.name}`);
    names.push(`ui-assets/${entry.name}`);
  }
  assert.ok(names.length > uiNames.length, 'The trusted UI build includes self-hosted fonts');
  const outputs = names.map(name => {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(filename) === filename, `Unsafe UI output: ${name}`);
    return { name, data: fs.readFileSync(filename) };
  });
  validateUiOutputs(outputs);
  return outputs;
}

function preparePack(draft, { title, category, tags, script = false, autoplay = false, documented = false, retired = false }) {
  const { id, version } = draft.manifest;
  const manifest = {
    ...draft.manifest,
    title, category, tags, scripts: script, autoplay,
    folder: { id: 'visual', title: 'Visual' },
    summary: `Временные данные браузерного теста ${id}, версия ${version}. Не содержимое библиотеки.`,
    status: 'published', visibility: 'public',
    source: { type: 'original', author: 'Disposable browser regression test' },
    license: { id: 'LicenseRef-Test-Fixture', file: 'LICENSE.txt', redistribution: true },
    review: { by: 'Automated local test fixture only', date: '2026-11-04' },
    assets: [{
      id: 'tokens', title: 'Тестовые токены', type: 'tokens', path: 'tokens.css', preview: 'preview/index.html',
      description: `Локальные стили версии ${version} для проверки исходников и превью.`,
      usage: `Используется только внутри временного контейнера .${id}. Не публиковать.`,
    }],
  };
  fs.writeFileSync(path.join(draft.directory, 'LICENSE.txt'), 'Original disposable automated-test fixture.\nPermission is granted to reproduce this fixture solely for software testing.\nNot curated library content.\n');
  fs.writeFileSync(path.join(draft.directory, 'README.md'), `# ${title}\n\nTemporary browser test: ${id}@${version}.\n\n## Usage\nKeep this fixture inside its temporary test directory.\n`);
  if (documented) manifest.assets.push({
    id: 'usage', title: 'Инструкция теста', type: 'documentation', path: 'README.md',
    description: 'Метаданные для проверки правил, количества ассетов и контекста чата.',
    usage: 'Прочитать как текст. Не импортировать этот тестовый пак в рабочий каталог.',
  });
  if (retired) manifest.assets.push({
    id: 'retired-usage', title: 'Архивная инструкция теста', type: 'documentation', path: 'README.md',
    description: 'Существует только в предыдущей версии временного набора.',
    usage: 'Проверка старой ссылки: каталог должен открыть актуальную коллекцию, не архивный ассет.',
  });
  if (script) {
    manifest.files = [...manifest.files, 'preview/run.js'];
    manifest.assets.push({
      id: 'interaction', title: 'Тестовый сценарий', type: 'script', path: 'preview/run.js', preview: 'preview/index.html',
      description: 'Безопасное локальное изменение собственного документа превью.',
      usage: 'Запускать только в sandbox при наличии явно проверенного autoplay. Старые версии остаются неактивными.',
    });
    fs.writeFileSync(path.join(draft.directory, 'preview/run.js'), 'document.body.dataset.fixtureReady = "true";\n');
  }
  fs.writeFileSync(path.join(draft.directory, 'preview/index.html'), `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id} ${version}: temporary QA</title><link rel="stylesheet" href="../tokens.css"></head><body><main class="${id}"><h1>${title}</h1><p>Изолированное тестовое превью ${version}.</p></main>${script ? '<script src="run.js"></script>' : ''}</body></html>\n`);
  fs.writeFileSync(path.join(draft.directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function createBrowserFixture() {
  // Read only this allowlist. Never copy the real api/raw/previews/downloads,
  // health metadata, build markers, or a whole production dist tree.
  const ui = readTrustedUi();
  const fixture = createCatalogFixture({ id: 'qa-browser-foundation', version: '1.0.0' });
  try {
    preparePack(fixture, { title: 'Альфа: временный тест', category: 'components', tags: ['qa', 'tokens'], retired: true });
    preparePack(createDraft(fixture.root, { id: 'qa-browser-foundation', version: '1.1.0' }), {
      title: 'Альфа: временный тест', category: 'components', tags: ['qa', 'tokens'], documented: true,
    });
    preparePack(createDraft(fixture.root, { id: 'qa-browser-motion', version: '1.0.0' }), {
      title: 'Бета: временный тест', category: 'motion', tags: ['qa', 'motion'], script: true, documented: true,
    });
    preparePack(createDraft(fixture.root, { id: 'qa-browser-motion', version: '2.0.0' }), {
      title: 'Бета: временный тест', category: 'motion', tags: ['qa', 'motion'], script: true, autoplay: true, documented: true,
    });
    const built = buildLibrary(fixture.root, { revision: 'local' });
    assert.equal(built.output, path.join(fixture.root, 'dist'));
    assert.equal(built.catalog.packs.length, 4, 'Two collections include static, reviewed autoplay, and inactive legacy versions');
    assert.equal(new Set(built.catalog.packs.map(pack => pack.id)).size, 2);
    const generatedCatalog = fs.readFileSync(path.join(built.output, 'api/catalog.json'));
    for (const file of ui) {
      const destination = path.join(built.output, file.name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.data, { mode: 0o644 });
    }
    assert.ok(fs.readFileSync(path.join(built.output, 'api/catalog.json')).equals(generatedCatalog), 'Copying UI assets leaves the fixture catalog intact');
    for (const pack of built.catalog.packs) {
      assert.ok(pack.tags.length && pack.assets.length && pack.source.author && pack.license.redistribution);
      assert.ok(fs.statSync(path.join(built.output, pack.previewUrl.slice(1))).isFile());
      assert.ok(fs.statSync(path.join(built.output, pack.downloadUrl.slice(1))).isFile());
      for (const file of pack.files) assert.ok(fs.statSync(path.join(built.output, file.url.slice(1))).isFile());
      assert.deepEqual(pack.folder, { id: 'visual', title: 'Visual' });
      for (const asset of pack.assets) {
        assert.equal(asset.url, `/raw/${pack.id}/${pack.version}/${asset.path}`);
        assert.ok(fs.statSync(path.join(built.output, asset.url.slice(1))).isFile());
        if (asset.previewUrl) {
          assert.equal(asset.previewUrl, `/previews/${pack.id}/${pack.version}/preview/index.html`);
          assert.ok(fs.statSync(path.join(built.output, asset.previewUrl.slice(1))).isFile());
        }
      }
    }
    return { ...fixture, ...built };
  } catch (error) {
    fixture.cleanup();
    throw error;
  }
}

async function run() {
  const fixture = createBrowserFixture();
  try {
    const env = { ...process.env };
    delete env.LIBRARY_URL;
    // Screenshots are intentionally retained outside the disposable fixture.
    if (env.SCREENSHOTS_DIR) env.SCREENSHOTS_DIR = path.resolve(env.SCREENSHOTS_DIR);
    console.log(JSON.stringify({ runner: 'browser-fixture-smoke', localOnly: true, packs: 2, versions: 4, productionCatalogUntouched: true }));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(projectRoot, 'tests/browser-smoke.mjs')], {
        cwd: fixture.root, env, stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (result.signal) throw new Error(`Browser fixture smoke terminated by ${result.signal}`);
    process.exitCode = result.code ?? 1;
  } finally {
    fixture.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
