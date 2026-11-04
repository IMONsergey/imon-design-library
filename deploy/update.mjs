// Installed root-owned; runs as the dedicated unprivileged deployment account.
// No GitHub token, webhook secret, pack hooks or access to other projects.
// This controller is installed separately by root; a git change cannot update it.
import { execFileSync } from 'node:child_process';
import { mkdir, lstat, realpath, readdir, readlink, readFile, writeFile, rename, symlink, cp } from 'node:fs/promises';
import path from 'node:path';
import { checkImmutability } from './check-immutability.mjs';

const ROOT = '/srv/imon-design-library';
const REPOSITORY = 'https://github.com/IMONsergey/imon-design-library.git';
const GIT = path.join(ROOT, 'git');
const BUILDS = path.join(ROOT, 'builds');
const RELEASES = path.join(ROOT, 'releases');
const SHA = /^[0-9a-f]{40}$/;
const run = (command, args, cwd = ROOT, timeout = 180000) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = args => run('git', args, GIT);
const exists = async filename => { try { await lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

async function checkedReleaseLink(name) {
  const filename = path.join(ROOT, name);
  if (!await exists(filename)) return null;
  if (!(await lstat(filename)).isSymbolicLink()) throw new Error(`${name} is not a symlink; refusing replacement`);
  const linked = path.resolve(ROOT, await readlink(filename));
  if (path.dirname(linked) !== RELEASES || !SHA.test(path.basename(linked))) throw new Error('Unexpected release link');
  const health = JSON.parse(await readFile(path.join(linked, 'health.json'), 'utf8'));
  if (health.revision !== path.basename(linked) || health.status !== 'ok') throw new Error('Invalid release marker');
  return health.revision;
}

async function switchRelease(revision) {
  const destination = path.join(RELEASES, revision);
  if (await realpath(destination) !== destination) throw new Error('Release path must not contain symlinks');
  const health = JSON.parse(await readFile(path.join(destination, 'health.json'), 'utf8'));
  if (health.revision !== revision || health.status !== 'ok') throw new Error('Release verification failed');
  const previous = await checkedReleaseLink('current');
  for (const [name, target] of [['previous', previous], ['current', revision]]) {
    if (!target) continue;
    const existing = path.join(ROOT, name);
    if (await exists(existing) && !(await lstat(existing)).isSymbolicLink()) throw new Error(`Refusing to replace non-symlink ${name}`);
    const next = path.join(ROOT, `.${name}-${process.pid}`);
    await symlink(path.join(RELEASES, target), next);
    await rename(next, existing);
  }
}

async function verifyOutput(root, relative = '') {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error(`Unsafe build output: ${name}`);
    if (entry.isDirectory()) await verifyOutput(root, name);
  }
}

async function deploy() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('Run as the dedicated deployment user, not root');
  for (const directory of [ROOT, BUILDS, RELEASES]) await mkdir(directory, { recursive: true });
  if (process.argv[2] === '--rollback') {
    const revision = process.argv[3] || await checkedReleaseLink('previous');
    if (!revision || !SHA.test(revision)) throw new Error('No verified rollback release');
    await switchRelease(revision);
    console.log(`Rolled back to ${revision}. Keep the timer stopped until the regression is fixed.`);
    return;
  }
  if (process.argv.length > 2) throw new Error('Unknown argument');
  if (!await exists(GIT)) {
    run('git', ['init', '--bare', GIT]);
    git(['remote', 'add', 'origin', REPOSITORY]);
  }
  if (git(['remote', 'get-url', 'origin']) !== REPOSITORY) throw new Error('Unexpected remote repository');
  git(['fetch', '--quiet', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const target = git(['rev-parse', 'refs/remotes/origin/main']);
  if (!SHA.test(target)) throw new Error('Invalid main commit');
  const current = await checkedReleaseLink('current');
  if (current === target) { console.log(`Already current: ${target}`); return; }
  if (current) {
    git(['merge-base', '--is-ancestor', current, target]);
    checkImmutability(current, target, GIT);
  }
  // Reject symlinks/submodules anywhere before checking out candidate code.
  const entries = git(['ls-tree', '-rz', target]).split('\0').filter(Boolean);
  for (const entry of entries) if (!/^(100644|100755) blob /.test(entry)) throw new Error('Symlinks/submodules are not supported in deployment');
  const worktree = path.join(BUILDS, target);
  if (!await exists(worktree)) git(['worktree', 'add', '--detach', worktree, target]);
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], worktree)) throw new Error('Build worktree has tracked modifications');
  process.env.LIBRARY_REVISION = target;
  const hasFrontend = await exists(path.join(worktree, 'frontend'));
  if (hasFrontend) {
    if (!await exists(path.join(worktree, 'package-lock.json'))) throw new Error('Frontend requires a committed root package lock');
    // Invoke npm's JavaScript entry with the same pinned Node runtime, not /usr/bin/node.
    const npmCli = await realpath(path.join(path.dirname(process.execPath), 'npm'));
    if (!(await lstat(npmCli)).isFile()) throw new Error('Missing npm CLI next to the Node runtime');
    console.log(run(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--include=dev', '--include=optional', '--no-audit', '--fund=false', '--cache', path.join(ROOT, 'npm-cache'), '--fetch-retries=1', '--fetch-timeout=60000'], worktree, 300000));
  }
  for (const args of [['scripts/validate.mjs'], ['--test', ...((await readdir(path.join(worktree, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`))], ['scripts/build.mjs']]) {
    console.log(run(process.execPath, args, worktree));
  }
  const output = path.join(worktree, 'dist');
  await verifyOutput(output);
  const catalog = JSON.parse(await readFile(path.join(output, 'api/catalog.json'), 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packs)) throw new Error('Invalid built catalog');
  const health = JSON.parse(await readFile(path.join(output, 'health.json'), 'utf8'));
  if (health.status !== 'ok' || health.revision !== target) throw new Error('Build revision does not match candidate commit');
  for (const file of ['index.html', 'app.css', 'app.js', ...(hasFrontend ? ['theme-init.js', 'third-party-notices.txt'] : [])]) if (!(await lstat(path.join(output, file))).isFile()) throw new Error(`Missing ${file}`);
  const destination = path.join(RELEASES, target);
  if (!await exists(destination)) {
    const staging = path.join(RELEASES, `.staging-${target}-${process.pid}`);
    await cp(output, staging, { recursive: true, errorOnExist: true, force: false });
    await writeFile(path.join(staging, 'health.json'), JSON.stringify({ ...health, publishedAt: new Date().toISOString() }) + '\n');
    await rename(staging, destination);
  }
  await switchRelease(target);
  console.log(`Published ${target}: ${catalog.packs.length} pack versions. Previous release retained.`);
}

deploy().catch(error => {
  console.error(error.message);
  if (error.stderr) console.error(String(error.stderr).slice(-6000));
  process.exitCode = 1;
});
