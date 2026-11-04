import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, isSlug, isVersion, validateManifest } from './lib/manifest.mjs';

function realDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Not a real directory: ${directory}`);
}

export function createDraft(root, { id, version = '0.1.0', title = id, category = 'components' } = {}) {
  root = path.resolve(root);
  if (!isSlug(id)) throw new Error('id must be a lowercase slug, for example quiet-buttons');
  if (!isVersion(version)) throw new Error('version must be major.minor.patch without leading zeros');
  if (!CATEGORIES.includes(category)) throw new Error(`category must be one of: ${CATEGORIES.join(', ')}`);
  const manifest = {
    schemaVersion: 1, id, version, title,
    summary: 'Черновик. Укажите назначение и границы использования пака.',
    category, status: 'draft', visibility: 'public', tags: [],
    license: { id: 'UNLICENSED', file: 'LICENSE.txt', redistribution: false },
    source: { type: 'original', author: 'Unreviewed' },
    preview: 'preview/index.html', scripts: false,
    files: ['LICENSE.txt', 'README.md', 'tokens.css', 'preview/index.html'],
    assets: [{ id: 'tokens', title: 'Токены', type: 'tokens', path: 'tokens.css', description: 'Изолированные CSS-токены черновика.', usage: `Подключайте только в контейнере .${id}. Проверьте права и совместимость перед публикацией.` }],
  };
  validateManifest(manifest);
  realDirectory(root);
  const packs = path.join(root, 'packs');
  if (!fs.existsSync(packs)) fs.mkdirSync(packs);
  realDirectory(packs);
  const pack = path.join(packs, id);
  if (!fs.existsSync(pack)) fs.mkdirSync(pack);
  realDirectory(pack);
  const target = path.join(pack, version);
  fs.mkdirSync(target); // Deliberately fails if the version already exists.
  fs.mkdirSync(path.join(target, 'preview'));
  const files = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'LICENSE.txt': 'UNREVIEWED DRAFT\nRights have not been confirmed. Do not publish or redistribute imported material until its license and source have been reviewed.\n',
    'README.md': `# ${id}\n\nСтатус: черновик.\n\n## Перед публикацией\n\n- Укажите реальный источник и автора.\n- Проверьте права на файлы, шрифты и зависимости.\n- Заполните лицензию, описание ассетов и инструкцию использования.\n- Проверьте превью, клавиатуру, мобильную версию и reduced motion.\n- После проверки задайте review.by, review.date, license.redistribution=true и status=published.\n\nНе добавляйте приватные материалы: этот GitHub-репозиторий публичный даже для черновиков.\n`,
    'tokens.css': `.${id} {\n  --${id}-surface: #f5f5f0;\n  --${id}-ink: #1f211f;\n  --${id}-space: 1rem;\n  color: var(--${id}-ink);\n  background: var(--${id}-surface);\n  padding: var(--${id}-space);\n}\n`,
    'preview/index.html': `<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>${id} / draft</title>\n  <link rel="stylesheet" href="../tokens.css">\n</head>\n<body><main class="${id}"><h1>${id}</h1><p>Черновик нового пака.</p></main></body>\n</html>\n`,
  };
  for (const [filename, content] of Object.entries(files)) fs.writeFileSync(path.join(target, filename), content, { flag: 'wx', mode: 0o644 });
  return { directory: target, manifest };
}

function parseArguments(args) {
  const [id, ...rest] = args;
  const values = { id };
  const options = new Set(['version', 'title', 'category']);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2);
    if (!rest[i]?.startsWith('--') || !options.has(key) || rest[i + 1] === undefined || Object.hasOwn(values, key)) throw new Error('Usage: npm run pack:new -- <id> [--version 0.1.0] [--title "Title"] [--category components]');
    values[key] = rest[i + 1];
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      console.log('Usage: npm run pack:new -- <id> [--version 0.1.0] [--title "Title"] [--category components]');
      console.log(`Categories: ${CATEGORIES.join(', ')}. Creates an unpublished draft with unreviewed rights.`);
    } else {
      const result = createDraft(process.cwd(), parseArguments(process.argv.slice(2)));
      console.log(`Created draft ${path.relative(process.cwd(), result.directory)}. Rights remain unreviewed; the draft is not published.`);
    }
  } catch (error) { console.error(`Cannot create pack: ${error.message}`); process.exitCode = 1; }
}
