import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkImmutability, assertImmutableSnapshot } from '../scripts/check-immutability.mjs';

async function gitFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'imon-idl-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'test']); git(['config', 'user.email', 'test@example.invalid']);
  const folder = path.join(root, 'packs/test/1.0.0');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ status: 'published', visibility: 'public' }));
  await writeFile(path.join(folder, 'file.css'), 'a{}');
  git(['add', '.']); git(['commit', '-qm', 'initial']);
  const base = git(['rev-parse', 'HEAD']);
  return { root, folder, git, base };
}

test('published version changes are blocked; a new version is allowed', async t => {
  const { root, folder, git, base } = await gitFixture(t);
  await mkdir(path.join(root, 'packs/test/1.1.0'), { recursive: true });
  await writeFile(path.join(root, 'packs/test/1.1.0/manifest.json'), '{}');
  git(['add', '.']); git(['commit', '-qm', 'new version']);
  const allowed = git(['rev-parse', 'HEAD']);
  assert.equal(checkImmutability(base, allowed, root), 1);
  await writeFile(path.join(folder, 'file.css'), 'b{}');
  git(['add', '.']); git(['commit', '-qm', 'mutated']);
  assert.throws(() => checkImmutability(base, git(['rev-parse', 'HEAD']), root), /immutable/);
  assert.throws(() => checkImmutability('--help', allowed, root), /Full hexadecimal/);
});

test('git-derived policy rejects deletion or relocation of an ordinary published version', async t => {
  const { root, folder, git, base } = await gitFixture(t);
  await rename(path.join(folder, 'file.css'), path.join(root, 'relocated.css'));
  git(['add', '-A']); git(['commit', '-qm', 'move outside packs']);
  assert.throws(() => checkImmutability(base, git(['rev-parse', 'HEAD']), root), /immutable.*packs\/test\/1\.0\.0/);
  await rm(folder, { recursive: true });
  git(['add', '-A']); git(['commit', '-qm', 'delete version']);
  assert.throws(() => checkImmutability(base, git(['rev-parse', 'HEAD']), root), /immutable/);
});

test('real git no-op and unrelated changes remain allowed', async t => {
  const { root, git, base } = await gitFixture(t);
  assert.equal(checkImmutability(base, base, root), 1);
  await writeFile(path.join(root, 'notes.txt'), 'Outside pack content.');
  git(['add', '.']); git(['commit', '-qm', 'notes']);
  assert.equal(checkImmutability(base, git(['rev-parse', 'HEAD']), root), 1);
});

const RETIREMENT_BASE = '303bd28c952962b7a17d7c1fbba81360f804a841';
const RETIRED_FOLDERS = ['interface-foundation', 'layout-recipes', 'motion-essentials'].map(id => `packs/${id}/1.0.0`);
const FOREIGN = 'packs/owner-content/1.0.0';

function retirementSnapshot() {
  const retiringFiles = RETIRED_FOLDERS.flatMap(folder => [`${folder}/manifest.json`, `${folder}/styles.css`]);
  const retainedFiles = [`${FOREIGN}/manifest.json`, `${FOREIGN}/styles.css`];
  return {
    publishedFolders: [...RETIRED_FOLDERS, FOREIGN],
    baseFiles: [...retiringFiles, ...retainedFiles],
    headFiles: retainedFiles,
    changes: retiringFiles.map(filename => ({ status: 'D', paths: [filename] })),
  };
}

test('only the exact approved base can retire all three complete starter versions', () => {
  const snapshot = retirementSnapshot();
  snapshot.changes.push({ status: 'M', paths: ['frontend/app.jsx'] });
  assert.doesNotThrow(() => assertImmutableSnapshot(RETIREMENT_BASE, snapshot));
  for (const base of ['0'.repeat(40), `${RETIREMENT_BASE.slice(0, -1)}2`, RETIREMENT_BASE.toUpperCase()]) {
    assert.throws(() => assertImmutableSnapshot(base, snapshot), /immutable/);
  }
});

test('retirement refuses partial deletion, retained files, or a retained version', () => {
  const incomplete = retirementSnapshot();
  incomplete.changes.pop();
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, incomplete), /immutable/);
  const retainedFile = retirementSnapshot();
  retainedFile.headFiles.push(`${RETIRED_FOLDERS[0]}/styles.css`);
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, retainedFile), /immutable/);
  const retainedVersion = retirementSnapshot();
  retainedVersion.changes = retainedVersion.changes.filter(change => !change.paths[0].startsWith(`${RETIRED_FOLDERS[2]}/`));
  retainedVersion.headFiles.push(...retainedVersion.baseFiles.filter(filename => filename.startsWith(`${RETIRED_FOLDERS[2]}/`)));
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, retainedVersion), /immutable/);
});

test('retirement cannot modify, replace, or add to an approved version', () => {
  for (const status of ['M', 'T', 'A']) {
    const changed = retirementSnapshot();
    changed.changes[0].status = status;
    assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, changed), /immutable/, status);
  }
  const additional = retirementSnapshot();
  const filename = `${RETIRED_FOLDERS[0]}/replacement.css`;
  additional.changes.push({ status: 'A', paths: [filename] });
  additional.headFiles.push(filename);
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, additional), /immutable/);
  const replacement = retirementSnapshot();
  replacement.headFiles.push(RETIRED_FOLDERS[0]);
  replacement.changes.push({ status: 'A', paths: [RETIRED_FOLDERS[0]] });
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, replacement), /immutable/);
});

test('retirement rejects renames and copies, including moves outside packs', () => {
  for (const status of ['R100', 'R080', 'C100']) {
    for (const destination of ['archive/styles.css', 'packs/another-pack/1.0.0/styles.css']) {
      const moved = retirementSnapshot();
      moved.changes[0] = { status, paths: [moved.changes[0].paths[0], destination] };
      assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, moved), /immutable/, `${status} ${destination}`);
    }
  }
});

test('the approved base does not permit modification or deletion of any other published pack', () => {
  for (const status of ['M', 'D']) {
    const changed = retirementSnapshot();
    changed.changes.push({ status, paths: [`${FOREIGN}/styles.css`] });
    if (status === 'D') changed.headFiles = changed.headFiles.filter(filename => filename !== `${FOREIGN}/styles.css`);
    assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, changed), /immutable.*packs\/owner-content\/1\.0\.0/);
  }
  const deleted = retirementSnapshot();
  deleted.changes.push(...deleted.headFiles.map(filename => ({ status: 'D', paths: [filename] })));
  deleted.headFiles = [];
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, deleted), /immutable.*packs\/owner-content\/1\.0\.0/);
});

test('retirement is a deletion-only packs transition, not a general allowlist override', () => {
  for (const filename of ['packs/new-pack/0.1.0/manifest.json', 'packs/interface-foundation/1.0.1/manifest.json', 'packs/README.md', 'packs']) {
    const added = retirementSnapshot();
    added.changes.push({ status: 'A', paths: [filename] });
    added.headFiles.push(filename);
    assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, added), /immutable/, filename);
  }
  const missingPublication = retirementSnapshot();
  missingPublication.publishedFolders = missingPublication.publishedFolders.filter(folder => folder !== RETIRED_FOLDERS[0]);
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, missingPublication), /immutable/);
  const duplicateDeletion = retirementSnapshot();
  duplicateDeletion.changes[1] = duplicateDeletion.changes[0];
  assert.throws(() => assertImmutableSnapshot(RETIREMENT_BASE, duplicateDeletion), /immutable/);
});

test('normal version additions on the approved base remain valid when no old pack is changed', () => {
  const snapshot = retirementSnapshot();
  snapshot.headFiles = [...snapshot.baseFiles, 'packs/owner-content/1.1.0/manifest.json'];
  snapshot.changes = [{ status: 'A', paths: ['packs/owner-content/1.1.0/manifest.json'] }];
  assert.doesNotThrow(() => assertImmutableSnapshot(RETIREMENT_BASE, snapshot));
});
