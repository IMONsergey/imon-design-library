import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Themes 3.3.0 Select.Content does not forward nonce to its two internal Viewports.
// These exact static scrollbar-hiding rules are pinned by tests/radix-csp.test.mjs:
// @radix-ui/react-select 2.4.1 and @radix-ui/react-scroll-area 1.4.0, dist/index.mjs.
// Dynamic scroll-lock styles still require the fresh request nonce; no broad style allowance.
export const RADIX_STYLE_HASHES = Object.freeze([
  'sha256-441zG27rExd4/il+NvIqyL8zFx5XmyNQtE381kSkUJk=',
  'sha256-vGQdhYJbTuF+M8iCn1IZCHpdkiICocWHDq4qnQF4Rjw=',
]);
export const CATALOG_CSP = `default-src 'none'; script-src 'self'; style-src 'self' ${RADIX_STYLE_HASHES.map(hash => `'${hash}'`).join(' ')}; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
export const PREVIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': CATALOG_CSP,
  'Cache-Control': 'no-cache',
};

export function createStaticServer(root) {
  const resolvedRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    const headers = { ...BASE_HEADERS };
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
        return response.end('Method not allowed');
      }
      const rawPath = (request.url || '/').split('?')[0];
      if (/%(?:2e|2f|5c|00)/i.test(rawPath) || rawPath.includes('\\')) throw new Error('path');
      const pathname = decodeURIComponent(rawPath);
      if (!pathname.startsWith('/') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error('path');
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const isPreview = relative.startsWith('previews/');
      const isRaw = relative.startsWith('raw/');
      const isDownload = relative.startsWith('downloads/');
      const isApi = relative.startsWith('api/');
      const isUiFont = /^ui-assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.woff2$/.test(relative);
      const isCatalogHtml = relative === 'index.html';
      if (!isPreview && !isRaw && !isDownload && !isApi && !isUiFont && !['index.html', 'app.css', 'app.js', 'theme-init.js', 'third-party-notices.txt', 'favicon.svg', 'health.json', 'robots.txt'].includes(relative)) throw new Error('path');
      const filename = path.resolve(resolvedRoot, relative);
      if (!filename.startsWith(resolvedRoot + path.sep)) throw new Error('path');
      const actual = await realpath(filename);
      if (!actual.startsWith(resolvedRoot + path.sep) || actual !== filename) throw new Error('path');
      const info = await lstat(filename);
      if (!info.isFile() || info.size > 66 * 1024 * 1024) throw new Error('path');
      if (isPreview) {
        headers['Content-Security-Policy'] = PREVIEW_CSP;
        headers['Access-Control-Allow-Origin'] = '*';
      }
      if (isRaw) {
        headers['Content-Type'] = 'text/plain; charset=utf-8';
        headers['Content-Disposition'] = 'attachment';
        headers['Content-Security-Policy'] = "sandbox; default-src 'none'; frame-ancestors 'none'";
      } else if (isDownload) {
        if (!relative.endsWith('.zip')) throw new Error('path');
        headers['Content-Type'] = 'application/zip';
        headers['Content-Disposition'] = 'attachment';
      } else {
        headers['Content-Type'] = MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream';
      }
      if (isApi) {
        if (!relative.endsWith('.json')) throw new Error('path');
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
      let body = request.method === 'HEAD' && !isCatalogHtml ? undefined : await readFile(filename);
      if (isCatalogHtml) {
        const nonce = randomBytes(18).toString('base64');
        const html = body.toString('utf8');
        if (html.split('__IMON_CSP_NONCE__').length > 2) throw new Error('nonce');
        body = Buffer.from(html.replace('__IMON_CSP_NONCE__', nonce));
        headers['Content-Security-Policy'] = CATALOG_CSP.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);
        headers['Cache-Control'] = 'no-store';
      }
      if (isUiFont) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      headers['Content-Length'] = body ? body.length : info.size;
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createStaticServer(path.resolve('dist'));
  server.listen(port, host, () => console.log(`I’MON Design Library: http://${host}:${port}`));
}
