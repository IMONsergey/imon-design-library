import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40,64}$/;

// One owner-authorized removal of the unrequested starter content. This is not a
// manifest flag or an operator override: only this exact base and the complete,
// deletion-only removal of all three versions can use the exception.
const RETIREMENT_BASE = '303bd28c952962b7a17d7c1fbba81360f804a841';
const RETIRED_FOLDERS = Object.freeze([
  'packs/interface-foundation/1.0.0',
  'packs/layout-recipes/1.0.0',
  'packs/motion-essentials/1.0.0',
]);

function within(filename, folder) { return filename === folder || filename.startsWith(`${folder}/`); }

function approvedRetirement(base, { publishedFolders, baseFiles, headFiles, changes }) {
  if (base !== RETIREMENT_BASE || !RETIRED_FOLDERS.every(folder => publishedFolders.includes(folder))) return false;
  const retiring = filename => RETIRED_FOLDERS.some(folder => within(filename, folder));
  const expected = new Set(baseFiles.filter(retiring));
  if (!RETIRED_FOLDERS.every(folder => expected.has(`${folder}/manifest.json`)) || headFiles.some(retiring)) return false;
  const packChanges = changes.filter(change => change.paths.some(filename => within(filename, 'packs')));
  return packChanges.length === expected.size
    && packChanges.every(change => change.status === 'D' && change.paths.length === 1 && expected.has(change.paths[0]))
    && new Set(packChanges.map(change => change.paths[0])).size === expected.size;
}

// Pure policy boundary for offline tests; the CLI supplies only git-derived
// snapshots. There is deliberately no configurable retirement base or allowlist.
export function assertImmutableSnapshot(base, snapshot) {
  const retiring = approvedRetirement(base, snapshot);
  const locked = snapshot.publishedFolders.filter(folder => {
    const changed = snapshot.changes.some(change => change.paths.some(filename => within(filename, folder)));
    return changed && !(retiring && RETIRED_FOLDERS.includes(folder));
  });
  if (locked.length) throw new Error(`Published versions are immutable. Create a new version instead: ${locked.join(', ')}`);
}

function parseChanges(output) {
  const fields = output.split('\0');
  if (fields.pop() !== '') throw new Error('Invalid NUL-delimited git diff');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const count = /^[RC][0-9]{1,3}$/.test(status) ? 2 : /^[ADMTUXB]$/.test(status) ? 1 : 0;
    if (!count || index + count > fields.length) throw new Error('Unexpected git diff status');
    const paths = fields.slice(index, index + count);
    if (paths.some(filename => !filename)) throw new Error('Empty git diff path');
    changes.push({ status, paths });
    index += count;
  }
  return changes;
}

export function checkImmutability(base, head, cwd = process.cwd()) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('Full hexadecimal commit SHAs are required');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const filesAt = ref => git(['ls-tree', '-rz', '--full-tree', '--name-only', ref, '--', 'packs/']).split('\0').filter(Boolean);
  const baseFiles = filesAt(base);
  const headFiles = filesAt(head);
  const paths = baseFiles.filter(name => /^packs\/[a-z0-9-]+\/[0-9]+\.[0-9]+\.[0-9]+\/manifest\.json$/.test(name));
  const publishedFolders = [];
  for (const filename of paths) {
    const manifest = JSON.parse(git(['show', `${base}:${filename}`]));
    if (manifest.status === 'published' && manifest.visibility === 'public') publishedFolders.push(filename.slice(0, -'/manifest.json'.length));
  }
  // Inspect the whole diff, not just packs/: a move out of packs must be seen as
  // a rename, never mistaken for an approved deletion. Explicit flags override
  // repository rename settings; no external diff or text conversion is executed.
  const changes = parseChanges(git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--find-renames=50%', '-l0', '--name-status', '-z', base, head, '--']));
  assertImmutableSnapshot(base, { publishedFolders, baseFiles, headFiles, changes });
  return paths.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = checkImmutability(process.argv[2] || '', process.argv[3] || '', process.env.IMON_GIT_DIR || process.cwd());
    console.log(`Immutability check passed (${count} previous manifests).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
