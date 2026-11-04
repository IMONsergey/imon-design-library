// Browser boundary for generated catalog metadata. The build-time validator owns
// publication rights, resource inspection and file contents; do not import it here.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const HASH = /^[0-9a-f]{64}$/;
const CATEGORIES = new Set(['design-system', 'components', 'motion', 'icons', 'typography', 'guidelines', 'templates']);

function check(condition, field) {
  if (!condition) throw new Error(`Invalid catalog: ${field}`);
}

function record(value, field) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), field);
}

function text(value, field, max = 1000) {
  check(typeof value === 'string' && value.length > 0 && value.length <= max, field);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), field);
}

function slug(value, field) {
  check(typeof value === 'string' && value.length <= 80 && SLUG.test(value), field);
}

function filePath(value, field) {
  text(value, field, 240);
  const parts = value.split('/');
  check(parts.length <= 12 && parts.every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith('.')), field);
}

function originValue(origin) {
  check(typeof origin === 'string', 'origin');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('Invalid catalog: origin'); }
  check(['https:', 'http:'].includes(parsed.protocol) && parsed.origin === origin, 'origin');
  return parsed.origin;
}

function exactPath(value, expected, origin, field) {
  check(typeof value === 'string' && value === expected, field);
  const parsed = new URL(value, origin);
  check(parsed.origin === origin && parsed.pathname === value && !parsed.search && !parsed.hash, field);
}

function previewPath(value, base, listed, origin, field) {
  check(typeof value === 'string' && value.startsWith(base), field);
  const filename = value.slice(base.length);
  filePath(filename, field);
  check(/\.html?$/.test(filename) && listed.has(filename), field);
  exactPath(value, `${base}${filename}`, origin, field);
}

function provenance(source) {
  if (source === undefined) return;
  record(source, 'source');
  if (source.author !== undefined) text(source.author, 'source.author', 200);
  if (source.url !== undefined) {
    text(source.url, 'source.url', 2048);
    let parsed;
    try { parsed = new URL(source.url); } catch { throw new Error('Invalid catalog: source.url'); }
    check(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'source.url');
  }
}

/** Validate a generated pack without DOM globals or mutation; return its identity. */
export function validatePack(pack, origin) {
  origin = originValue(origin);
  record(pack, 'pack');
  if (pack.schemaVersion !== undefined) check(pack.schemaVersion === 1, 'schemaVersion');
  slug(pack.id, 'id');
  check(typeof pack.version === 'string' && VERSION.test(pack.version), 'version');
  text(pack.title, 'title', 120);
  text(pack.summary, 'summary');
  check(CATEGORIES.has(pack.category), 'category');
  if (pack.folder !== undefined) {
    record(pack.folder, 'folder');
    check(Object.keys(pack.folder).every(key => ['id', 'title'].includes(key)), 'folder');
    slug(pack.folder.id, 'folder.id');
    text(pack.folder.title, 'folder.title', 120);
    check(pack.folder.title === pack.folder.title.trim(), 'folder.title');
  }
  check(typeof pack.scripts === 'boolean', 'scripts');
  if (pack.autoplay !== undefined) check(typeof pack.autoplay === 'boolean', 'autoplay');
  check(Array.isArray(pack.tags) && pack.tags.length <= 20, 'tags');
  pack.tags.forEach(tag => text(tag, 'tags', 48));
  record(pack.license, 'license');
  text(pack.license.id, 'license.id', 120);
  provenance(pack.source);
  if (pack.review !== undefined) {
    record(pack.review, 'review');
    text(pack.review.by, 'review.by', 200);
    text(pack.review.date, 'review.date', 10);
    check(/^\d{4}-\d{2}-\d{2}$/.test(pack.review.date), 'review.date');
  }
  if (pack.autoplay === true) check(pack.scripts === true && pack.review !== undefined, 'autoplay requires scripts and review');
  check(Number.isSafeInteger(pack.downloadSize) && pack.downloadSize >= 0, 'downloadSize');
  if (pack.downloadSha256 !== undefined) check(typeof pack.downloadSha256 === 'string' && HASH.test(pack.downloadSha256), 'downloadSha256');

  const base = `${pack.id}/${pack.version}/`;
  exactPath(pack.downloadUrl, `/downloads/${pack.id}-${pack.version}.zip`, origin, 'downloadUrl');
  exactPath(pack.manifestUrl, `/api/packs/${pack.id}/${pack.version}.json`, origin, 'manifestUrl');
  check(Array.isArray(pack.files) && pack.files.length > 0 && pack.files.length <= 256, 'files');
  const listed = new Set();
  const folded = new Set();
  for (const file of pack.files) {
    record(file, 'file');
    filePath(file.path, 'file.path');
    check(!folded.has(file.path.toLowerCase()), 'duplicate file.path');
    listed.add(file.path);
    folded.add(file.path.toLowerCase());
    check(Number.isSafeInteger(file.size) && file.size >= 0, 'file.size');
    check(typeof file.sha256 === 'string' && HASH.test(file.sha256), 'file.sha256');
    exactPath(file.url, `/raw/${base}${file.path}`, origin, 'file.url');
  }
  if (pack.license.file !== undefined) {
    filePath(pack.license.file, 'license.file');
    check(listed.has(pack.license.file), 'license.file');
  }
  const previewBase = `/previews/${base}`;
  previewPath(pack.previewUrl, previewBase, listed, origin, 'previewUrl');

  check(Array.isArray(pack.assets) && pack.assets.length > 0 && pack.assets.length <= 256, 'assets');
  const assetIds = new Set();
  for (const asset of pack.assets) {
    record(asset, 'asset');
    slug(asset.id, 'asset.id');
    check(!assetIds.has(asset.id), 'duplicate asset.id');
    assetIds.add(asset.id);
    text(asset.title, 'asset.title', 120);
    text(asset.description, 'asset.description');
    text(asset.usage, 'asset.usage', 10000);
    filePath(asset.path, 'asset.path');
    check(listed.has(asset.path), 'asset.path');
    if (asset.url !== undefined) exactPath(asset.url, `/raw/${base}${asset.path}`, origin, 'asset.url');
    if (asset.previewUrl !== undefined) previewPath(asset.previewUrl, previewBase, listed, origin, 'asset.previewUrl');
  }
  return pack;
}
