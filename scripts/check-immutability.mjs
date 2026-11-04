import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40,64}$/;
export function checkImmutability(base, head, cwd = process.cwd()) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('Full hexadecimal commit SHAs are required');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const paths = git(['ls-tree', '-rz', '--name-only', base, '--', 'packs/']).split('\0').filter(name => /^packs\/[a-z0-9-]+\/[0-9]+\.[0-9]+\.[0-9]+\/manifest\.json$/.test(name));
  const locked = [];
  for (const filename of paths) {
    const manifest = JSON.parse(git(['show', `${base}:${filename}`]));
    if (manifest.status !== 'published' || manifest.visibility !== 'public') continue;
    const folder = filename.slice(0, -'/manifest.json'.length);
    const changes = git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base, head, '--', folder]).split('\0').filter(Boolean);
    if (changes.length) locked.push(folder);
  }
  if (locked.length) throw new Error(`Published versions are immutable. Create a new version instead: ${locked.join(', ')}`);
  return paths.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = checkImmutability(process.argv[2] || '', process.argv[3] || '', process.env.IMON_GIT_DIR || process.cwd());
    console.log(`Immutability check passed (${count} previous manifests).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
