import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRelativePath } from './lib/manifest.mjs';

const SHELL_FILES = ['index.html', 'favicon.svg', 'theme-init.js'];
const NOTICE_FILE = 'third-party-notices.txt';
const MARKER_ID = 'imon-design-library-ui-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 256;
export const NONCE_PLACEHOLDER = '__IMON_CSP_NONCE__';
const MISSING_LICENSES = new Map([
  ['react-remove-scroll-bar@2.3.8', fileURLToPath(new URL('./licenses/react-remove-scroll-bar-2.3.8.txt', import.meta.url))],
]);

function exists(filename) {
  try { fs.lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function realDirectory(directory) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error(`Expected a real directory: ${directory}`);
}

function shellFiles(root) {
  const directory = path.join(root, 'site');
  realDirectory(directory);
  return SHELL_FILES.map(name => {
    const filename = path.join(directory, name);
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o111 || info.size > MAX_FILE_BYTES) throw new Error(`Unsafe site shell: ${name}`);
    return { name, data: fs.readFileSync(filename) };
  });
}

export function validateUiOutputs(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Too many UI output files');
  const seen = new Set();
  let bytes = 0;
  for (const { name, data } of files) {
    safeRelativePath(name);
    if (!['app.js', 'app.css', NOTICE_FILE, ...SHELL_FILES].includes(name) && !/^ui-assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.woff2$/.test(name)) throw new Error(`Unexpected UI output: ${name}`);
    if (seen.has(name.toLowerCase())) throw new Error(`Duplicate UI output: ${name}`);
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new Error(`Invalid UI output bytes: ${name}`);
    if (data.byteLength > MAX_FILE_BYTES || (bytes += data.byteLength) > MAX_BYTES) throw new Error('UI output exceeds size limits');
    seen.add(name.toLowerCase());
  }
  for (const name of ['app.js', 'app.css', NOTICE_FILE, ...SHELL_FILES]) if (!seen.has(name)) throw new Error(`Missing UI output: ${name}`);
  const html = Buffer.from(files.find(file => file.name === 'index.html').data).toString('utf8');
  if (html.split(NONCE_PLACEHOLDER).length !== 2 || !html.includes(`<meta name="csp-nonce" content="${NONCE_PLACEHOLDER}">`)) throw new Error('Catalog HTML must contain exactly one CSP nonce meta placeholder');
  return { files: files.length, bytes };
}

export function validateUiInputs(root, metadata) {
  const frontend = path.join(root, 'frontend') + path.sep;
  const dependencies = path.join(root, 'node_modules') + path.sep;
  if (!metadata?.inputs || !metadata?.outputs) throw new Error('Missing UI build metadata');
  for (const name of Object.keys(metadata.inputs)) {
    const filename = path.resolve(root, name);
    if (!filename.startsWith(frontend) && !filename.startsWith(dependencies)) throw new Error(`UI imports may only use frontend/ and installed dependencies: ${name}`);
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(filename) !== filename) throw new Error(`Unsafe UI source: ${name}`);
  }
  for (const output of Object.values(metadata.outputs)) {
    if (output.imports?.some(item => item.external)) throw new Error('UI output must not contain external runtime imports');
  }
}

export function thirdPartyNotices(root, metadata) {
  const packages = new Map();
  const nodeModules = `${path.sep}node_modules${path.sep}`;
  for (const input of Object.keys(metadata.inputs)) {
    const filename = path.resolve(root, input);
    const moduleStart = filename.lastIndexOf(nodeModules);
    if (moduleStart === -1) continue;
    const start = moduleStart + nodeModules.length;
    const parts = filename.slice(start).split(path.sep);
    const directory = path.join(filename.slice(0, start), ...parts.slice(0, parts[0].startsWith('@') ? 2 : 1));
    if (packages.has(directory)) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(manifest.name) || typeof manifest.version !== 'string' || !/^[0-9][a-z0-9.+-]*$/i.test(manifest.version)) throw new Error('Invalid dependency identity for license notices');
    const licenses = fs.readdirSync(directory).filter(name => /^(?:licen[cs]e(?:[.-](?:md|txt|mit))?|copying)$/i.test(name)).sort().map(name => path.join(directory, name));
    const preservedLicense = MISSING_LICENSES.get(`${manifest.name}@${manifest.version}`);
    if (!licenses.length && preservedLicense) licenses.push(preservedLicense);
    if (!licenses.length) throw new Error(`Missing bundled dependency license: ${manifest.name}`);
    const texts = licenses.map(filename => {
      const info = fs.lstatSync(filename);
      if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(filename) !== filename || info.size > 256 * 1024) throw new Error(`Unsafe dependency license: ${manifest.name}`);
      return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(filename)).trim();
    });
    packages.set(directory, { name: manifest.name, version: manifest.version, text: texts.join('\n\n') });
  }
  // Only license text and package identity are published, never npm configuration or metadata.
  return Buffer.from('Third-party software and font notices\nCatalog interface only. Asset packs retain their separate licenses.\n\n' + [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en')).map(item => `${item.name}@${item.version}\n${'='.repeat(72)}\n${item.text}\n`).join('\n'));
}

// Only trusted catalog source is compiled. Pack contents are never imported or executed.
// The compiler injection keeps boundary tests dependency-free, not a pack extension API.
export async function buildUi(root = process.cwd(), { compiler } = {}) {
  root = path.resolve(root);
  realDirectory(root);
  realDirectory(path.join(root, 'frontend'));
  const shell = shellFiles(root);
  const cache = path.join(root, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  realDirectory(cache);
  const output = path.join(cache, 'ui');
  const markerFile = path.join(cache, 'ui-marker.json');
  if (exists(markerFile)) {
    const markerInfo = fs.lstatSync(markerFile);
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.nlink !== 1) throw new Error('Unsafe UI output marker');
  }
  if (exists(output)) {
    realDirectory(output);
    let marker;
    try {
      if (!fs.lstatSync(markerFile).isFile() || fs.lstatSync(markerFile).isSymbolicLink()) throw new Error('marker');
      marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    } catch { throw new Error('Refusing to replace unmanaged UI output'); }
    if (marker.id !== MARKER_ID) throw new Error('Refusing to replace unmanaged UI output');
  }
  const staging = fs.mkdtempSync(path.join(cache, 'ui-build-'));
  let previous = null;
  try {
    const compile = compiler || (await import('esbuild')).build;
    const result = await compile({
      absWorkingDir: root,
      entryPoints: { app: 'frontend/app.jsx' },
      outdir: staging,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['safari16'],
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.woff2': 'file' },
      assetNames: 'ui-assets/[name]-[hash]',
      publicPath: '/',
      splitting: false,
      minify: true,
      sourcemap: false,
      legalComments: 'inline',
      metafile: true,
      write: false,
      logLevel: 'warning',
    });
    validateUiInputs(root, result.metafile);
    const files = [...shell, { name: NOTICE_FILE, data: thirdPartyNotices(root, result.metafile) }, ...result.outputFiles.map(file => ({ name: path.relative(staging, file.path).split(path.sep).join('/'), data: file.contents }))];
    const summary = validateUiOutputs(files);
    for (const { name, data } of files) {
      const destination = path.join(staging, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, data, { mode: 0o644, flag: 'wx' });
    }
    fs.chmodSync(staging, 0o755);
    if (exists(output)) {
      previous = path.join(fs.mkdtempSync(path.join(cache, 'ui-previous-')), 'site');
      fs.renameSync(output, previous);
    }
    try { fs.renameSync(staging, output); }
    catch (error) { if (previous) fs.renameSync(previous, output); throw error; }
    // Marker is outside public UI output; subsequent builds never replace unmanaged data.
    fs.writeFileSync(markerFile, `${JSON.stringify({ id: MARKER_ID })}\n`, { mode: 0o644 });
    return { output, previous, ...summary };
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-ui.mjs (run in project root)');
    const result = await buildUi();
    console.log(`Built catalog UI: ${result.files} files / ${result.bytes} bytes into .cache/ui.`);
  } catch (error) { console.error(`UI build failed: ${error.message}`); process.exitCode = 1; }
}
