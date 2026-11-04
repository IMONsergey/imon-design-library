import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadLibrary, loadSite } from './lib/manifest.mjs';
import { createZip } from './lib/zip.mjs';

const MARKER = '.imon-build.json';
const MARKER_ID = 'imon-design-library-static-v1';
const manifestSchema = JSON.parse(fs.readFileSync(new URL('../schemas/pack.schema.json', import.meta.url), 'utf8'));
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function write(directory, relative, data) {
  const target = path.join(directory, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: 'wx', mode: 0o644 });
}

export function buildLibrary(root = process.cwd(), { revision = process.env.LIBRARY_REVISION || 'local' } = {}) {
  root = path.resolve(root);
  if (!/^(?:local|[0-9a-f]{7,64})$/.test(revision)) throw new Error('LIBRARY_REVISION must be local or a Git SHA');
  const packs = loadLibrary(root);
  const site = loadSite(root);
  const published = packs.filter(({ manifest }) => manifest.status === 'published' && manifest.visibility === 'public');
  const output = path.join(root, 'dist');
  if (fs.existsSync(output)) {
    if (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink()) throw new Error('Refusing to replace dist: not a real directory');
    let marker;
    try { marker = JSON.parse(fs.readFileSync(path.join(output, MARKER), 'utf8')); } catch { throw new Error('Refusing to replace unmanaged dist directory; move it aside first'); }
    if (marker.id !== MARKER_ID) throw new Error('Refusing to replace unmanaged dist directory');
  }
  const cache = path.join(root, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.lstatSync(cache).isDirectory() || fs.lstatSync(cache).isSymbolicLink()) throw new Error('.cache must be a real directory');
  const staging = fs.mkdtempSync(path.join(cache, 'build-'));
  let previous = null;
  try {
    for (const [name, content] of site) write(staging, name, content);
    const catalog = { schemaVersion: 1, packs: [] };
    for (const pack of published) {
      const { manifest, files } = pack;
      const base = `${manifest.id}/${manifest.version}`;
      const archive = createZip([
        { name: 'manifest.json', data: pack.rawManifest },
        ...[...files].map(([name, file]) => ({ name, data: file.data })),
      ]);
      const item = {
        schemaVersion: 1,
        id: manifest.id, version: manifest.version, title: manifest.title, summary: manifest.summary,
        category: manifest.category, tags: manifest.tags, license: manifest.license, source: manifest.source,
        review: manifest.review, scripts: manifest.scripts,
        previewUrl: `/previews/${base}/${manifest.preview}`,
        downloadUrl: `/downloads/${manifest.id}-${manifest.version}.zip`,
        downloadSize: archive.length,
        downloadSha256: createHash('sha256').update(archive).digest('hex'),
        manifestUrl: `/api/packs/${base}.json`,
        files: [...files].map(([filename, file]) => ({ path: filename, url: `/raw/${base}/${filename}`, size: file.size, sha256: file.sha256 })),
        assets: manifest.assets,
      };
      for (const [filename, file] of files) {
        write(staging, `raw/${base}/${filename}`, file.data);
        write(staging, `previews/${base}/${filename}`, file.data);
      }
      write(staging, item.downloadUrl.slice(1), archive);
      write(staging, item.manifestUrl.slice(1), json(item));
      catalog.packs.push(item);
    }
    write(staging, 'api/catalog.json', json(catalog));
    write(staging, 'api/schema.json', json(manifestSchema));
    const health = { status: 'ok', schemaVersion: 1, revision, packVersions: published.length, assets: published.reduce((sum, pack) => sum + pack.manifest.assets.length, 0) };
    write(staging, 'health.json', json(health));
    write(staging, MARKER, json({ id: MARKER_ID, revision }));
    if (fs.existsSync(output)) {
      previous = path.join(fs.mkdtempSync(path.join(cache, 'previous-')), 'dist');
      fs.renameSync(output, previous);
    }
    try { fs.renameSync(staging, output); }
    catch (error) { if (previous) fs.renameSync(previous, output); throw error; }
    return { output, previous, catalog, health, excluded: packs.length - published.length };
  } catch (error) {
    // Only this invocation's exact mkdtemp directory is removed, never a user directory.
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/build.mjs (run in project root)');
    const result = buildLibrary();
    console.log(`Built ${result.health.packVersions} published pack versions / ${result.health.assets} assets into dist (${result.excluded} draft/private versions excluded).`);
    if (result.previous) console.log(`Previous build retained at ${path.relative(process.cwd(), result.previous)}.`);
  } catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
}
