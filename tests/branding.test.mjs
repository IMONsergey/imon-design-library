import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
test('catalog uses the exact official imon.agency SVG path, not a text wordmark', () => {
  const brand = fs.readFileSync(new URL('../frontend/brand.jsx', import.meta.url), 'utf8');
  const path = brand.match(/ d="([^"]+)"/)[1];
  assert.equal(hash(path), '0c1e10f31d9e5b600c6255252634e78ec952c019ccb6ed04c49fc1b711e80d99');
  assert.match(brand, /viewBox="0 0 1496 481"/);
  assert.match(brand, /fill="currentColor"/);
  assert.doesNotMatch(brand, /<text[\s>]|<script[\s>]|<image[\s>]/i);
  const app = fs.readFileSync(new URL('../frontend/app.jsx', import.meta.url), 'utf8');
  assert.match(app, /<BrandMark\s*\/>/);
  assert.doesNotMatch(app, /brand-wordmark/);
});

test('tab icon preserves the original official ICO bytes without a third-party request', () => {
  const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const encoded = html.match(/href="data:image\/x-icon;base64,([A-Za-z0-9+/=]+)"/)[1];
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.length, 4286);
  assert.equal(hash(bytes), '5654bc121421c749a595c168ba47a5aee3f3a14bd67f034037bfa87474505782');
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1);
  assert.equal(bytes.readUInt16LE(4), 1);
});
