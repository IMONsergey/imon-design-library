import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const CATEGORIES = ['design-system', 'components', 'motion', 'icons', 'typography', 'guidelines', 'templates'];
export const ASSET_TYPES = ['component', 'stylesheet', 'script', 'tokens', 'documentation', 'image', 'font', 'template'];
export const LIMITS = Object.freeze({ fileBytes: 16 * 1024 * 1024, packBytes: 64 * 1024 * 1024, libraryBytes: 256 * 1024 * 1024, filesPerPack: 256, packs: 500, manifestBytes: 128 * 1024, depth: 12 });
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.pdf']);
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg']);
const SENSITIVE_NAMES = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|authorized_keys|known_hosts)$/i;
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const PRIVATE_MARKERS = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{16,}/i,
];

function fail(context, message) { throw new Error(`${context}: ${message}`); }
function check(condition, context, message) { if (!condition) fail(context, message); }
function object(value, context, allowed, required = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), context, 'expected an object');
  for (const key of Object.keys(value)) check(allowed.includes(key), context, `unknown field ${JSON.stringify(key)}`);
  for (const key of required) check(Object.hasOwn(value, key), context, `missing field ${JSON.stringify(key)}`);
}
function string(value, context, max = 300, min = 1) {
  check(typeof value === 'string' && value.length >= min && value.length <= max && value === value.trim(), context, `expected trimmed text (${min}-${max} characters)`);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), context, 'control characters are not allowed');
}
function oneOf(value, values, context) { check(values.includes(value), context, `expected one of ${values.join(', ')}`); }
function array(value, context, max, min = 0) { check(Array.isArray(value) && value.length >= min && value.length <= max, context, `expected an array of ${min}-${max} items`); }
function unique(values, context) { check(new Set(values).size === values.length, context, 'duplicate values are not allowed'); }
export function isSlug(value) { return typeof value === 'string' && value.length <= 80 && SLUG.test(value); }
export function isVersion(value) { return typeof value === 'string' && VERSION.test(value); }

/** Manifest paths are portable, unambiguous POSIX relative paths, not URLs. */
export function safeRelativePath(value, context = 'path') {
  string(value, context, 240);
  const parts = value.split('/');
  check(parts.length <= LIMITS.depth, context, `path exceeds ${LIMITS.depth} segments`);
  for (const part of parts) {
    check(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith('.'), context, 'use relative ASCII file paths; no dotfiles, parent traversal, URLs, spaces or encoded characters');
    check(!SENSITIVE_NAMES.test(part), context, 'credential/secret filenames are not allowed');
    check(!RESERVED_NAMES.test(part), context, 'reserved device filenames are not portable');
  }
  check(path.posix.normalize(value) === value, context, 'path is not normalized');
  return value;
}

function sourceUrl(value, context) {
  string(value, context, 2048);
  let parsed;
  try { parsed = new URL(value); } catch { fail(context, 'expected an HTTPS URL'); }
  check(parsed.protocol === 'https:' && !parsed.username && !parsed.password, context, 'only credential-free HTTPS provenance URLs are allowed');
  for (const key of parsed.searchParams.keys()) check(!/^(?:access_token|auth|authorization|api_key|apikey|secret|password|token)$/i.test(key), context, 'do not publish authentication values in source URLs');
}

export function validateManifest(manifest, expected = {}) {
  const c = expected.context || 'manifest';
  const fields = ['schemaVersion', 'id', 'version', 'title', 'summary', 'category', 'status', 'visibility', 'tags', 'license', 'source', 'review', 'preview', 'scripts', 'files', 'assets'];
  object(manifest, c, fields, ['schemaVersion', 'id', 'version', 'title', 'summary', 'category', 'status', 'visibility', 'tags', 'license', 'source', 'scripts', 'files', 'assets']);
  check(manifest.schemaVersion === 1, c, 'schemaVersion must be 1');
  check(isSlug(manifest.id), c, 'id must be a lowercase ASCII slug (max 80 characters)');
  check(isVersion(manifest.version), c, 'version must be numeric major.minor.patch without leading zeros');
  if (expected.id) check(manifest.id === expected.id, c, 'id does not match its directory');
  if (expected.version) check(manifest.version === expected.version, c, 'version does not match its directory');
  string(manifest.title, `${c}.title`, 120);
  string(manifest.summary, `${c}.summary`, 1000);
  oneOf(manifest.category, CATEGORIES, `${c}.category`);
  oneOf(manifest.status, ['draft', 'published'], `${c}.status`);
  oneOf(manifest.visibility, ['public', 'private'], `${c}.visibility`);
  check(typeof manifest.scripts === 'boolean', c, 'scripts must be a boolean');
  array(manifest.tags, `${c}.tags`, 20);
  manifest.tags.forEach((tag, i) => string(tag, `${c}.tags[${i}]`, 48));
  unique(manifest.tags, `${c}.tags`);

  object(manifest.license, `${c}.license`, ['id', 'file', 'redistribution'], ['id', 'file', 'redistribution']);
  string(manifest.license.id, `${c}.license.id`, 120);
  check(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(manifest.license.id), c, 'license.id must be an SPDX identifier or a LicenseRef identifier');
  safeRelativePath(manifest.license.file, `${c}.license.file`);
  check(/\.(?:md|txt)$/.test(manifest.license.file), c, 'license.file must be a readable .txt or .md file');
  check(typeof manifest.license.redistribution === 'boolean', c, 'license.redistribution must be a boolean');
  object(manifest.source, `${c}.source`, ['type', 'author', 'url'], ['type', 'author']);
  oneOf(manifest.source.type, ['original', 'third-party'], `${c}.source.type`);
  string(manifest.source.author, `${c}.source.author`, 200);
  if (manifest.source.url !== undefined) sourceUrl(manifest.source.url, `${c}.source.url`);
  if (manifest.source.type === 'third-party') check(Boolean(manifest.source.url), c, 'third-party sources require source.url');

  if (manifest.review !== undefined) {
    object(manifest.review, `${c}.review`, ['by', 'date'], ['by', 'date']);
    string(manifest.review.by, `${c}.review.by`, 200);
    check(typeof manifest.review.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(manifest.review.date), c, 'review.date must use YYYY-MM-DD');
    const date = new Date(`${manifest.review.date}T00:00:00Z`);
    check(Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === manifest.review.date, c, 'review.date is not a real date');
  }
  if (manifest.preview !== undefined) {
    safeRelativePath(manifest.preview, `${c}.preview`);
    check(/\.html?$/.test(manifest.preview), c, 'preview must be a local HTML file');
  }

  array(manifest.files, `${c}.files`, LIMITS.filesPerPack, 1);
  manifest.files.forEach((file, i) => {
    safeRelativePath(file, `${c}.files[${i}]`);
    check(file !== 'manifest.json', c, 'manifest.json is included automatically; do not list it in files');
    check(EXTENSIONS.has(path.posix.extname(file).toLowerCase()), c, `unsupported or executable file type: ${file}`);
  });
  unique(manifest.files.map((file) => file.toLowerCase()), `${c}.files (case-insensitive)`);
  const listed = new Set(manifest.files);
  check(listed.has(manifest.license.file), c, 'license.file must be included in files');
  if (manifest.preview) check(listed.has(manifest.preview), c, 'preview must be included in files');

  array(manifest.assets, `${c}.assets`, 256);
  const ids = [];
  for (const [index, asset] of manifest.assets.entries()) {
    const a = `${c}.assets[${index}]`;
    object(asset, a, ['id', 'title', 'type', 'path', 'description', 'usage'], ['id', 'title', 'type', 'path', 'description', 'usage']);
    check(isSlug(asset.id), a, 'id must be a lowercase ASCII slug');
    ids.push(asset.id);
    string(asset.title, `${a}.title`, 120);
    string(asset.description, `${a}.description`, 1000);
    string(asset.usage, `${a}.usage`, 10000);
    oneOf(asset.type, ASSET_TYPES, `${a}.type`);
    safeRelativePath(asset.path, `${a}.path`);
    check(listed.has(asset.path), a, 'asset.path must be included in files');
  }
  unique(ids, `${c}.assets.id`);
  if (manifest.status === 'published') {
    check(manifest.license.redistribution === true, c, 'published packs require explicit license.redistribution=true');
    check(manifest.license.id !== 'UNLICENSED', c, 'review and document rights before publishing');
    check(Boolean(manifest.review), c, 'published packs require review.by and review.date');
    check(Boolean(manifest.preview), c, 'published packs require a preview');
    check(manifest.assets.length > 0, c, 'published packs require at least one asset');
  }
  return manifest;
}

function ensureDirectory(directory, context) {
  const stat = fs.lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink(), context, 'expected a real directory, not a symlink');
}

/** This is a guard against known secret patterns, not a substitute for source review. */
export function checkSecrets(text, context) {
  for (const marker of PRIVATE_MARKERS) check(!marker.test(text), context, 'possible credential or private key detected; move it out of this public repository');
}

function readRegular(root, relative, maxBytes = LIMITS.fileBytes) {
  safeRelativePath(relative, relative);
  let parent = root;
  ensureDirectory(parent, root);
  const segments = relative.split('/');
  for (const segment of segments.slice(0, -1)) { parent = path.join(parent, segment); ensureDirectory(parent, relative); }
  const full = path.join(root, ...segments);
  const lst = fs.lstatSync(full);
  check(lst.isFile() && !lst.isSymbolicLink(), relative, 'only regular files are accepted; symlinks are forbidden');
  check(lst.nlink === 1, relative, 'hard links are not accepted; copy the file into the pack');
  check(!(lst.mode & 0o111), relative, 'executable permissions are not allowed on asset files');
  check(lst.size <= maxBytes, relative, `file exceeds ${Math.round(maxBytes / 1024)} KiB`);
  const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.ino === lst.ino && before.dev === lst.dev && before.size === lst.size, relative, 'file changed during validation; retry with a stable source');
    const data = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    check(data.length <= maxBytes && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, relative, 'file changed during validation; retry with a stable source');
    if (TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      check(!text.includes('\u0000'), relative, 'text files must not contain NUL bytes');
      checkSecrets(text, relative);
    }
    return data;
  } finally { fs.closeSync(fd); }
}

function walk(root, relative = '', state = { files: [], bytes: 0 }, limits = { files: LIMITS.filesPerPack + 1, bytes: LIMITS.packBytes }) {
  ensureDirectory(path.join(root, relative), relative || root);
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    safeRelativePath(name, name);
    check(!entry.isSymbolicLink(), name, 'symlinks are forbidden');
    if (entry.isDirectory()) walk(root, name, state, limits);
    else {
      check(entry.isFile(), name, 'only directories and regular files are allowed');
      state.files.push(name);
      state.bytes += fs.lstatSync(path.join(root, name)).size;
      check(state.files.length <= limits.files && state.bytes <= limits.bytes, root, 'directory exceeds the file count or size limit');
    }
  }
  return state.files;
}

function htmlUrl(value, context) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', Tab: '\t', NewLine: '\n' };
  const decoded = value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, n) => {
    const number = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    check(number <= 0x10ffff, context, 'invalid URL character reference');
    return String.fromCodePoint(number);
  }).replace(/&([A-Za-z]+);/g, (all, name) => Object.hasOwn(entities, name) ? entities[name] : all);
  check(!/&[A-Za-z][A-Za-z0-9]+;/.test(decoded), context, 'unsupported URL character reference');
  return decoded;
}

/** Resource references can use ../ only while resolving inside their own pack. */
export function resolveLocalResource(value, from, listed, context = from) {
  const url = htmlUrl(value, context).trim();
  if (!url || url.startsWith('#')) return null;
  check(!/[\u0000-\u0020\u007f\\]/.test(url), context, 'resource URLs cannot contain whitespace, control characters or backslashes');
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url)) return null;
  check(!/^[A-Za-z][A-Za-z\d+.-]*:/.test(url) && !url.startsWith('/'), context, 'preview resources must stay inside this pack; external, absolute and protocol URLs are forbidden');
  const pathname = url.split(/[?#]/, 1)[0];
  check(!pathname.includes('%'), context, 'percent-encoded resource paths are ambiguous; use local ASCII file names');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), pathname));
  safeRelativePath(resolved, context);
  check(listed.has(resolved), context, `resource ${JSON.stringify(value)} resolves to an unlisted or missing file ${JSON.stringify(resolved)}`);
  return resolved;
}

function inspectCss(text, from, listed) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/\\(?:[0-9a-f]{1,6}\s?|\r?\n)/i.test(css), from, 'escaped CSS resource syntax is not supported; normalize the CSS before import');
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) resolveLocalResource(match[1] ?? match[2] ?? match[3], from, listed);
  for (const match of css.matchAll(/@import\s+["']([^"']+)["']/gi)) resolveLocalResource(match[1], from, listed);
}

function inspectMarkup(text, from, listed, scripts) {
  const markup = text.replace(/<!--[\s\S]*?-->/g, '');
  check(!/<\s*(?:iframe|object|embed|base|form|portal|fencedframe)\b/i.test(markup), from, 'embedded pages, forms and base URLs are not allowed in previews');
  for (const meta of markup.matchAll(/<\s*meta\b[^>]*>/gi)) {
    const equiv = meta[0].match(/\bhttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (equiv) check(htmlUrl(equiv[1] ?? equiv[2] ?? equiv[3], from).trim().toLowerCase() !== 'refresh', from, 'meta-refresh navigation is not allowed in previews');
  }
  if (from.toLowerCase().endsWith('.svg')) check(!/<!\s*(?:ENTITY|DOCTYPE)|<\s*foreignObject\b/i.test(markup), from, 'SVG entities, DTDs and foreignObject are not allowed');
  if (!scripts) check(!/<\s*script\b|\s+on[a-z]+\s*=/i.test(markup), from, 'script tags and event handlers require scripts=true and a reviewed pack');
  const attributes = /\s(?:src|href|xlink:href|poster|action|formaction|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of markup.matchAll(attributes)) resolveLocalResource(match[1] ?? match[2] ?? match[3], from, listed);
  for (const match of markup.matchAll(/\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const candidate of (match[1] ?? match[2]).split(',')) resolveLocalResource(candidate.trim().split(/\s+/, 1)[0], from, listed);
  }
  for (const match of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) inspectCss(match[1], from, listed);
  for (const match of markup.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) inspectCss(htmlUrl(match[1] ?? match[2], from), from, listed);
}

function loadPack(directory, id, version) {
  const rawManifest = readRegular(directory, 'manifest.json', LIMITS.manifestBytes);
  let manifest;
  try { manifest = JSON.parse(rawManifest.toString('utf8')); } catch { fail(`${id}/${version}/manifest.json`, 'invalid JSON'); }
  validateManifest(manifest, { id, version, context: `${id}/${version}/manifest.json` });
  const actual = walk(directory);
  const listed = new Set(manifest.files);
  for (const filename of actual) check(filename === 'manifest.json' || listed.has(filename), `${id}/${version}`, `unlisted file ${JSON.stringify(filename)}; list it or move it to inbox outside the repository`);
  const files = new Map();
  let bytes = rawManifest.length;
  for (const filename of [...manifest.files].sort()) {
    let data;
    try { data = readRegular(directory, filename); } catch (error) { fail(`${id}/${version}/${filename}`, error.message); }
    bytes += data.length;
    check(bytes <= LIMITS.packBytes, `${id}/${version}`, 'pack exceeds size limit');
    files.set(filename, { data, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    const extension = path.posix.extname(filename).toLowerCase();
    if (extension === '.css') inspectCss(data.toString('utf8'), filename, listed);
    if (['.html', '.htm', '.svg'].includes(extension)) inspectMarkup(data.toString('utf8'), filename, listed, manifest.scripts);
  }
  check(files.get(manifest.license.file).size > 0, `${id}/${version}`, 'license file must not be empty');
  if (manifest.status === 'published') check(files.get(manifest.preview).size > 0, `${id}/${version}`, 'preview must not be empty');
  return { directory, manifest, files, rawManifest, bytes };
}

export function loadLibrary(root) {
  root = path.resolve(root);
  const packsDirectory = path.join(root, 'packs');
  if (!fs.existsSync(packsDirectory)) return [];
  ensureDirectory(packsDirectory, 'packs');
  const result = [];
  let bytes = 0;
  for (const entry of fs.readdirSync(packsDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === 'README.md' && entry.isFile()) continue;
    check(entry.isDirectory() && !entry.isSymbolicLink() && isSlug(entry.name), `packs/${entry.name}`, 'expected a real pack directory with a lowercase slug');
    for (const release of fs.readdirSync(path.join(packsDirectory, entry.name), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      check(release.isDirectory() && !release.isSymbolicLink() && isVersion(release.name), `packs/${entry.name}/${release.name}`, 'expected a real semantic-version directory');
      check(result.length < LIMITS.packs, 'packs', `too many versions (limit ${LIMITS.packs})`);
      const pack = loadPack(path.join(packsDirectory, entry.name, release.name), entry.name, release.name);
      bytes += pack.bytes;
      check(bytes <= LIMITS.libraryBytes, 'packs', 'library exceeds the total size limit; use separately reviewed external storage for large media');
      result.push(pack);
    }
  }
  return result;
}

export function loadSite(root, { siteRoot = path.join(path.resolve(root), 'site') } = {}) {
  root = path.resolve(root);
  const directory = path.resolve(root, siteRoot);
  check([path.join(root, 'site'), path.join(root, '.cache/ui')].includes(directory), 'siteRoot', 'must be site/ or the generated .cache/ui directory');
  check(fs.realpathSync(directory) === directory, 'siteRoot', 'symlinked source directories are not allowed');
  ensureDirectory(directory, 'site');
  const files = new Map();
  for (const filename of walk(directory, '', { files: [], bytes: 0 }, { files: 256, bytes: 32 * 1024 * 1024 })) {
    check(!/^(?:api|raw|previews|downloads|health\.json)(?:\/|$)/i.test(filename), filename, 'reserved generated output path');
    check(EXTENSIONS.has(path.posix.extname(filename).toLowerCase()), filename, 'unsupported site file type');
    files.set(filename, readRegular(directory, filename));
  }
  check(files.has('index.html'), 'site', 'missing index.html');
  return files;
}
