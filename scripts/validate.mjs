import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from './lib/manifest.mjs';

export function validateLibrary(root = process.cwd()) {
  const packs = loadLibrary(root);
  return {
    versions: packs.length,
    published: packs.filter(({ manifest }) => manifest.status === 'published' && manifest.visibility === 'public').length,
    assets: packs.reduce((sum, pack) => sum + pack.manifest.assets.length, 0),
    bytes: packs.reduce((sum, pack) => sum + pack.bytes, 0),
    privateVersions: packs.filter(({ manifest }) => manifest.visibility === 'private').length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/validate.mjs (run in project root)');
    const result = validateLibrary();
    console.log(`Validated ${result.versions} pack versions / ${result.assets} assets. ${result.published} versions are public and published.`);
    if (result.privateVersions) console.warn('Private manifests are excluded from the site, but this Git repository is public. Keep private materials outside Git.');
  } catch (error) { console.error(`Validation failed: ${error.message}`); process.exitCode = 1; }
}
