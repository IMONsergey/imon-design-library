import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDraft } from '../../scripts/new-pack.mjs';
import { buildLibrary } from '../../scripts/build.mjs';

// Never writes into the repository or production packs. The published flag is
// test input needed to exercise the real builder; all output stays in mkdtemp.
export function createCatalogFixture({ id = 'boundary-fixture', version = '1.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imon-catalog-fixture-'));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(root, 'site'));
    fs.writeFileSync(path.join(root, 'site/index.html'), '<!doctype html><title>Temporary catalog fixture</title>');
    const fixture = createDraft(root, { id, version });
    const manifest = {
      ...fixture.manifest, status: 'published',
      source: { type: 'original', author: 'Automated test fixture' },
      license: { ...fixture.manifest.license, id: 'LicenseRef-Test-Fixture', redistribution: true },
      review: { by: 'Temporary test fixture, not library content', date: '2026-11-04' },
    };
    fs.writeFileSync(path.join(fixture.directory, 'manifest.json'), JSON.stringify(manifest));
    return { root, directory: fixture.directory, manifest, ...buildLibrary(root), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
