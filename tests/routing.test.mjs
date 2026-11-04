import test from 'node:test';
import assert from 'node:assert/strict';
import { latestPacks, packHref, parseRoute, resolveRoute } from '../frontend/routing.mjs';

function pack(id, version, assetIds = ['round']) {
  return { id, version, title: `${id} ${version}`, assets: assetIds.map(assetId => ({ id: assetId, title: assetId })) };
}

const previous = pack('diamonds', '1.0.0', ['round', 'retired']);
const current = pack('diamonds', '1.1.0', ['round', 'oval']);
const other = pack('icons', '2.0.0', ['arrow']);
const catalog = [previous, other, current];

test('collection and asset links are stable and never pin a catalog version', () => {
  assert.equal(packHref(previous), '#pack=diamonds');
  assert.equal(packHref(current), '#pack=diamonds');
  assert.equal(packHref('diamonds'), '#pack=diamonds');
  assert.equal(packHref(current, current.assets[0]), '#pack=diamonds&asset=round');
  assert.equal(packHref('diamonds', 'round'), '#pack=diamonds&asset=round');
});

test('canonical collection and asset routes parse without a requested version', () => {
  const collection = parseRoute('#pack=diamonds');
  assert.equal(collection.kind, 'collection');
  assert.equal(collection.packId, 'diamonds');
  assert.equal(collection.legacyVersion, undefined);
  const asset = parseRoute('#pack=diamonds&asset=round');
  assert.equal(asset.kind, 'asset');
  assert.equal(asset.packId, 'diamonds');
  assert.equal(asset.assetId, 'round');
  assert.equal(asset.hash, '#pack=diamonds&asset=round');
});

test('legacy versioned links are parsed as migration inputs, not selected versions', () => {
  const route = parseRoute('#pack=diamonds@1.0.0&asset=round');
  assert.equal(route.kind, 'asset');
  assert.equal(route.packId, 'diamonds');
  assert.equal(route.legacyVersion, '1.0.0');
  assert.equal(route.assetId, 'round');
});

test('ordinary library, folder and favorites routes remain available', () => {
  for (const hash of ['', '#', '#catalog']) assert.equal(parseRoute(hash).kind, 'all', hash);
  assert.equal(parseRoute('#folder=visual').kind, 'folder');
  assert.equal(parseRoute('#folder=visual').folderId, 'visual');
  assert.equal(parseRoute('#view=favorites').kind, 'favorites');
});

test('malformed and ambiguous links fail closed rather than selecting arbitrary packs', () => {
  for (const hash of [
    '#pack=', '#pack=../diamonds', '#pack=Diamonds', '#pack=diamonds@1.0',
    '#pack=diamonds@01.0.0', '#pack=diamonds@1.0.0-beta', '#pack=diamonds@1.0.0@2.0.0',
    '#pack=diamonds&asset=', '#pack=diamonds&asset=../round', '#asset=round',
    '#pack=diamonds&pack=icons', '#pack=diamonds&asset=round&asset=oval',
    '#pack=diamonds&folder=visual', '#pack=diamonds&view=favorites',
    '#folder=visual&folder=other', '#view=favorites&folder=visual',
    '#folder=', '#view=unknown', '#unknown=true', '#pack=diamonds&unknown=true',
  ]) assert.equal(parseRoute(hash).kind, 'missing', hash);
});

test('latest selection compares all semantic version components numerically', () => {
  const values = [
    pack('major', '9.999.999'), pack('major', '10.0.0'),
    pack('minor', '1.9.99'), pack('minor', '1.10.0'),
    pack('patch', '1.0.9'), pack('patch', '1.0.10'),
  ];
  const selected = Object.fromEntries(latestPacks(values).map(item => [item.id, item.version]));
  assert.deepEqual(selected, { major: '10.0.0', minor: '1.10.0', patch: '1.0.10' });
});

test('latest selection is independent of catalog order and leaves source data intact', () => {
  const input = Object.freeze([...catalog]);
  assert.deepEqual(new Map(latestPacks(input).map(item => [item.id, item.version])), new Map([['diamonds', '1.1.0'], ['icons', '2.0.0']]));
  assert.deepEqual(new Map(latestPacks([...input].reverse()).map(item => [item.id, item.version])), new Map([['diamonds', '1.1.0'], ['icons', '2.0.0']]));
  assert.deepEqual(input, [previous, other, current]);
  assert.strictEqual(latestPacks(input).find(item => item.id === current.id), current);
  assert.deepEqual(latestPacks([]), []);
});

test('a canonical collection route always resolves to the latest published pack', () => {
  const resolved = resolveRoute(parseRoute('#pack=diamonds'), catalog);
  assert.equal(resolved.missing, false);
  assert.strictEqual(resolved.pack, current);
  assert.equal(resolved.route.kind, 'collection');
  assert.equal(resolved.canonicalHash, '#pack=diamonds');
});

test('old and even future version pins cannot expose historical content through the catalog', () => {
  for (const version of ['1.0.0', '1.1.0', '0.0.1', '999.0.0']) {
    const resolved = resolveRoute(parseRoute(`#pack=diamonds@${version}`), catalog);
    assert.equal(resolved.missing, false);
    assert.strictEqual(resolved.pack, current);
    assert.equal(resolved.route.kind, 'collection');
    assert.equal(resolved.canonicalHash, '#pack=diamonds');
  }
});

test('legacy and canonical asset routes use the newest asset and preview/download metadata together', () => {
  for (const hash of ['#pack=diamonds&asset=round', '#pack=diamonds@1.0.0&asset=round']) {
    const resolved = resolveRoute(parseRoute(hash), catalog);
    assert.equal(resolved.missing, false);
    assert.strictEqual(resolved.pack, current);
    assert.strictEqual(resolved.asset, current.assets[0]);
    assert.notStrictEqual(resolved.asset, previous.assets[0]);
    assert.equal(resolved.route.kind, 'asset');
    assert.equal(resolved.canonicalHash, '#pack=diamonds&asset=round');
  }
});

test('a retired asset from a legacy link falls back to the current collection', () => {
  const resolved = resolveRoute(parseRoute('#pack=diamonds@1.0.0&asset=retired'), catalog);
  assert.equal(resolved.missing, false);
  assert.strictEqual(resolved.pack, current);
  assert.equal(resolved.asset, null);
  assert.equal(resolved.route.kind, 'collection');
  assert.equal(resolved.canonicalHash, '#pack=diamonds');
});

test('a missing asset in a new stable link remains a real not-found state', () => {
  const resolved = resolveRoute(parseRoute('#pack=diamonds&asset=missing'), catalog);
  assert.equal(resolved.missing, true);
  assert.equal(resolved.asset, null);
});

test('unknown collections cannot resolve to an unrelated latest pack', () => {
  for (const hash of ['#pack=unknown', '#pack=unknown@1.0.0', '#pack=unknown&asset=round']) {
    const resolved = resolveRoute(parseRoute(hash), catalog);
    assert.equal(resolved.missing, true);
    assert.equal(resolved.pack, null);
  }
});

test('a newly published version is used without rewriting a stable link or mutating prior records', () => {
  const route = Object.freeze(parseRoute('#pack=diamonds&asset=round'));
  const future = pack('diamonds', '1.2.0', ['round', 'pear']);
  const before = structuredClone(catalog);
  assert.strictEqual(resolveRoute(route, catalog).pack, current);
  const resolved = resolveRoute(route, [...catalog, future]);
  assert.strictEqual(resolved.pack, future);
  assert.strictEqual(resolved.asset, future.assets[0]);
  assert.equal(resolved.canonicalHash, '#pack=diamonds&asset=round');
  assert.deepEqual(catalog, before);
});
