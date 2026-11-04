// Catalog links identify material, not an immutable storage version.
// This module is DOM-free so redirects and latest selection are testable.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const validId = value => typeof value === 'string' && value.length <= 80 && SLUG.test(value);

function compareVersions(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (aa[index] !== bb[index]) return aa[index] - bb[index];
  return 0;
}

/** Keep each id's highest numeric x.y.z version, without changing the input. */
export function latestPacks(packs) {
  const selected = new Map();
  for (const pack of packs) {
    if (!pack || !validId(pack.id) || typeof pack.version !== 'string' || !VERSION.test(pack.version)) continue;
    const previous = selected.get(pack.id);
    if (!previous || compareVersions(pack.version, previous.version) > 0) selected.set(pack.id, pack);
  }
  return [...selected.values()];
}

export function packHref(pack, asset) {
  const id = typeof pack === 'string' ? pack : pack?.id;
  const assetId = typeof asset === 'string' ? asset : asset?.id;
  if (!validId(id) || (asset !== undefined && !validId(assetId))) throw new TypeError('Invalid material id');
  return '#pack=' + id + (assetId ? '&asset=' + assetId : '');
}

export function folderHref(folder) {
  const id = typeof folder === 'string' ? folder : folder?.id;
  if (!validId(id)) throw new TypeError('Invalid folder id');
  return '#folder=' + id;
}

/** Parse only supported, unambiguous routes. Legacy versions are syntax only. */
export function parseRoute(hash = '') {
  if (typeof hash !== 'string') return { kind: 'missing', hash: '' };
  if (!hash || hash === '#' || hash === '#catalog') return { kind: 'all', hash };
  if (!hash.startsWith('#') || hash.length > 600) return { kind: 'missing', hash };
  const params = new URLSearchParams(hash.slice(1));
  const keys = [...params.keys()];
  const missing = () => ({ kind: 'missing', hash });
  if (new Set(keys).size !== keys.length) return missing();
  if (params.has('pack')) {
    if (keys.some(key => key !== 'pack' && key !== 'asset')) return missing();
    const parts = params.get('pack').split('@');
    if (parts.length > 2 || !validId(parts[0]) || (parts.length === 2 && !VERSION.test(parts[1]))) return missing();
    const assetId = params.get('asset');
    if (params.has('asset') && !validId(assetId)) return missing();
    return { kind: assetId ? 'asset' : 'collection', hash, packId: parts[0],
      ...(assetId ? { assetId } : {}), ...(parts.length === 2 ? { legacyVersion: parts[1] } : {}) };
  }
  if (keys.length === 1 && keys[0] === 'folder' && validId(params.get('folder'))) return { kind: 'folder', hash, folderId: params.get('folder') };
  if (keys.length === 1 && keys[0] === 'view' && params.get('view') === 'favorites') return { kind: 'favorites', hash };
  return missing();
}

/**
 * Resolve against the newest data only. The caller replaces canonicalHash in
 * history; it never pushes an extra redirect entry. Missing canonical assets
 * remain errors. An obsolete asset in a legacy version link opens its collection.
 */
export function resolveRoute(parsed, packs) {
  const fail = () => ({ route: parsed, pack: null, asset: null, canonicalHash: parsed.hash, missing: true });
  if (parsed.kind === 'missing') return fail();
  const latest = latestPacks(packs);
  if (parsed.kind === 'collection' || parsed.kind === 'asset') {
    const pack = latest.find(item => item.id === parsed.packId);
    if (!pack) return fail();
    const asset = parsed.kind === 'asset' ? pack.assets.find(item => item.id === parsed.assetId) || null : null;
    if (parsed.kind === 'asset' && !asset && !parsed.legacyVersion) return fail();
    const canonicalHash = packHref(pack, asset || undefined);
    return { route: parseRoute(canonicalHash), pack, asset, canonicalHash, missing: false };
  }
  if (parsed.kind === 'folder') {
    if (!latest.some(pack => pack.folder?.id === parsed.folderId)) return fail();
    const canonicalHash = folderHref(parsed.folderId);
    return { route: parseRoute(canonicalHash), pack: null, asset: null, canonicalHash, missing: false };
  }
  if (parsed.kind === 'all' || parsed.kind === 'favorites') {
    const canonicalHash = parsed.kind === 'all' ? '' : '#view=favorites';
    return { route: parseRoute(canonicalHash), pack: null, asset: null, canonicalHash, missing: false };
  }
  return fail();
}
