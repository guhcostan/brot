import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveWebPath } from './web-files';

const ROOT = resolve('/srv/web');

describe('contentTypeFor', () => {
  it('maps the asset types a Vite build emits', () => {
    expect(contentTypeFor('/srv/web/assets/index.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/srv/web/assets/index.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/srv/web/assets/inter.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/srv/web/favicon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('/srv/web/index.html')).toBe('text/html; charset=utf-8');
  });

  it('falls back to a binary type for unknown extensions', () => {
    expect(contentTypeFor('/srv/web/data.bin')).toBe('application/octet-stream');
    expect(contentTypeFor('/srv/web/noext')).toBe('application/octet-stream');
  });
});

describe('resolveWebPath', () => {
  it('maps URL paths inside the root', () => {
    expect(resolveWebPath(ROOT, '/index.html')).toBe(resolve(ROOT, 'index.html'));
    expect(resolveWebPath(ROOT, '/assets/index.js')).toBe(resolve(ROOT, 'assets', 'index.js'));
  });

  it('collapses traversal segments at the root instead of escaping it', () => {
    const file = resolveWebPath(ROOT, '/../../etc/passwd');
    expect(file).toBe(resolve(ROOT, 'etc', 'passwd'));
    expect(file?.startsWith(ROOT + sep)).toBe(true);
  });

  it('keeps backslash traversal inside the root', () => {
    const file = resolveWebPath(ROOT, '/..\\..\\secret');
    expect(file === undefined || file.startsWith(ROOT + sep)).toBe(true);
  });

  it('rejects NUL bytes', () => {
    expect(resolveWebPath(ROOT, '/index.html\0.png')).toBeUndefined();
  });
});
