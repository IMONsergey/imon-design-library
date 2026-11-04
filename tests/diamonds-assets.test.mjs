import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { loadLibrary } from '../scripts/lib/manifest.mjs';
import { CUTS, ORIGINAL_SHA256, renderAllDiamonds, reviewedSections } from '../scripts/split-diamonds.mjs';

const root = new URL('../', import.meta.url);
const packRoot = new URL('../packs/visual-weblg/1.1.0/', import.meta.url);
const original = fs.readFileSync(new URL('../packs/visual-weblg/1.0.0/diamond-cut-study-restored.html', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', packRoot), 'utf8'));
const expected = ['round', 'oval', 'pear', 'marquise', 'cushion', 'princess', 'emerald', 'radiant', 'asscher', 'trillion'];
const files = expected.map(id => [id, fs.readFileSync(new URL(`assets/${id}.html`, packRoot), 'utf8')]);

function between(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Expected complete section ${start}`);
  return text.slice(first, last);
}

test('Diamonds Collection retains the immutable owner source and guarded derivation', () => {
  assert.equal(Buffer.byteLength(original), 27113);
  assert.equal(createHash('sha256').update(original).digest('hex'), ORIGINAL_SHA256);
  assert.equal(ORIGINAL_SHA256, '59ceac923be98dd8cf158fab14b9b221f61fea045f75463eaddb0ffcc89ea402');
  assert.throws(() => reviewedSections(`${original}\n`), /preserved original source has changed/);
  const rendered = renderAllDiamonds(original);
  assert.equal(rendered.size, 10);
  for (const [filename, content] of rendered) assert.equal(fs.readFileSync(new URL(filename, root), 'utf8'), content, filename);
});

test('Visual folder contains a collection of ten declared independent live assets', () => {
  const pack = loadLibrary(root.pathname).find(item => item.manifest.id === 'visual-weblg' && item.manifest.version === '1.1.0');
  assert.ok(pack);
  assert.equal(manifest.title, 'Diamonds Collection');
  assert.deepEqual(manifest.folder, { id: 'visual', title: 'Visual' });
  assert.equal(manifest.scripts, true);
  assert.equal(manifest.autoplay, true);
  assert.equal(manifest.preview, 'assets/round.html');
  assert.equal(manifest.review.date, '2026-11-04');
  assert.equal(manifest.source.author, 'Сергей Отческов / I’MON');
  assert.equal(manifest.license.id, 'LicenseRef-IMON-Proprietary');
  assert.deepEqual(manifest.assets.map(asset => asset.id), expected);
  assert.deepEqual(CUTS.map(cut => cut.id), expected);
  assert.equal(pack.files.size, 12);
  for (const asset of manifest.assets) {
    assert.equal(asset.path, `assets/${asset.id}.html`);
    assert.equal(asset.preview, asset.path);
    assert.equal(asset.type, 'component');
    assert.ok(manifest.files.includes(asset.path));
  }
});

test('all three GLSL shaders retain the original exact text for every diamond', () => {
  for (const name of ['VS', 'BG', 'FS']) {
    const expression = name === 'VS' ? /const VS="([^"]*)";/ : new RegExp(`const ${name}=\\x60([\\s\\S]*?)\\x60;`);
    const sourceShader = original.match(expression)?.[1];
    assert.ok(sourceShader, name);
    for (const [id, html] of files) assert.equal(html.match(expression)?.[1], sourceShader, `${id}: ${name}`);
  }
});

test('shape geometry, normalization, rotation, projection and draw bounds are unchanged', () => {
  const geometry = between(original, 'const TAU=', 'const models={};');
  const drawing = between(original, 'function updateRotation(){', 'function adapt(dt){');
  for (const [id, html] of files) {
    assert.ok(html.includes(geometry), `${id}: complete original geometry`);
    assert.ok(html.includes(drawing), `${id}: complete original drawing`);
  }
});

test('every asset is a standalone document with exactly one preselected cut and no picker', () => {
  for (const [id, html] of files) {
    assert.match(html, /^<!doctype html>\n<html lang="ru">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.equal((html.match(/<canvas\b/g) || []).length, 1);
    assert.equal((html.match(/<script\b/g) || []).length, 1);
    assert.ok(html.includes(`id="imon-diamond-${id}"`));
    assert.ok(html.includes(`data-cut="${id}"`));
    assert.ok(html.includes(`const CUT_ID="${id}";`));
    assert.ok(html.includes('gem=model(CUT_ID)'));
    assert.doesNotMatch(html, /dc5-picker|function setCut\b|button\[data-cut\]|const models=/);
    assert.doesNotMatch(html, /<iframe\b|<dialog\b|\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(|importScripts|navigator\.sendBeacon|localStorage|document\.cookie|parent\.|top\.|postMessage|\bhttps?:\/\//);
    assert.doesNotMatch(html, /\b(?:src|href)\s*=/i);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    // Compile only, never evaluate imported code in Node or in the app DOM.
    assert.doesNotThrow(() => new Script(script, { filename: `${id}.html` }));
  }
});

test('small cards are responsive and bounded without modifying studio shaders', () => {
  for (const [id, html] of files) {
    assert.match(html, /html,body\{margin:0;width:100%;height:100%;overflow:hidden/);
    assert.doesNotMatch(html, /min-height:520px|height:520px/);
    assert.match(html, /compact=h<=360\|\|\(w<=560&&h<=440\)/);
    assert.ok(html.includes('Math.min(window.devicePixelRatio||1,1,480/Math.max(w,h))'), `${id}: cap card pixels`);
    assert.ok(html.includes('compact?1000/30:1000/60'), `${id}: frame cap`);
    assert.ok(html.includes('const seconds=dt*.001'), `${id}: time-based motion`);
    assert.ok(html.includes('orbitSpeed=.085,orbitDelay=2000'), `${id}: original soft auto orbit`);
    assert.ok(html.includes('if(compact)return;'), `${id}: card FPS is not mistaken for slow rendering`);
    assert.match(html, /@media\(max-height:360px\),\(max-width:560px\) and \(max-height:440px\)/);
  }
});

test('each isolated runtime has bounded lifecycle and recovers WebGL context', () => {
  for (const [id, html] of files) {
    assert.ok(html.includes('if(rafId)cancelAnimationFrame(rafId)'), `${id}: cancel pending frame`);
    assert.ok(html.includes('if(wakeId)clearTimeout(wakeId)'), `${id}: cancel wake timeout`);
    assert.ok(html.includes('destroyed=true;stop();events.abort()'), `${id}: destroy listeners`);
    assert.ok(html.includes('resizeObserver?.disconnect();intersectionObserver?.disconnect();removalObserver?.disconnect()'), `${id}: disconnect observers`);
    assert.ok(html.includes('if(!root.isConnected){destroy();return}'), `${id}: detached root cleanup`);
    assert.ok(html.includes('if(destroyed||contextLost||document.hidden||!visible)return'), `${id}: no hidden scheduling`);
    assert.ok(html.includes('if(!visible||document.hidden){stop();return}'), `${id}: no hidden loop`);
    assert.ok(html.includes('gl.deleteBuffer(buffer)'), `${id}: buffer release`);
    assert.ok(html.includes('gl.deleteProgram(p)'), `${id}: program release`);
    assert.ok(html.includes('gl.deleteShader(s)'), `${id}: shader release`);
    assert.ok(html.includes('"webglcontextlost"'), `${id}: context loss listener`);
    assert.ok(html.includes('"webglcontextrestored"'), `${id}: context recovery listener`);
    assert.ok(html.includes('try{initializeGpu();resize()}'), `${id}: resource recreation`);
    assert.ok(html.includes('root.dataset.status="unavailable"'), `${id}: honest fallback`);
    assert.doesNotMatch(html, /window\.__|globalThis\.__|debugApi|setInterval\s*\(/);
  }
});

test('idle canvas retains the rendered image and resize invalidates stale ready state', () => {
  for (const [id, html] of files) {
    assert.ok(html.includes('antialias:true,preserveDrawingBuffer:true,powerPreference:"high-performance"'), `${id}: preserve idle composited pixels`);
    assert.ok(html.includes('const resized=canvas.width!==width||canvas.height!==height'), `${id}: detect buffer reset`);
    assert.ok(html.includes('if(resized||root.dataset.status==="initializing")'), `${id}: pending only for an invalidated buffer`);
    assert.ok(html.includes('root.dataset.status="pending"'), `${id}: no stale ready status after buffer reset`);
    assert.ok(html.includes('gl.disable(gl.SCISSOR_TEST);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT)'), `${id}: white pending canvas`);
    assert.ok(html.includes('if(root.dataset.status!=="ready")root.dataset.status="ready"'), `${id}: ready follows full drawing`);
    assert.ok(html.includes('else if(!reduced&&!dragging)'), `${id}: no permanent idle loop for reduced motion`);
  }
});

test('keyboard, reduced motion and labeled view controls remain available', () => {
  for (const [id, html] of files) {
    assert.match(html, /<canvas[^>]+tabindex="0"[^>]+aria-label=/);
    for (const label of ['Ракурс 3/4', 'Вид сверху', 'Сбросить положение']) assert.ok(html.includes(`aria-label="${label}"`), `${id}: ${label}`);
    assert.ok(html.includes('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"'));
    assert.ok(html.includes('if(e.key==="Home")'));
    assert.ok(html.includes('prefers-reduced-motion: reduce'));
    assert.ok(html.includes('listen(media,"change"'));
    assert.ok(html.includes('orbitReady=!reduced&&!dragging'));
    assert.ok(html.includes('||reduced?0:velocityYaw*freshness'));
  }
});
