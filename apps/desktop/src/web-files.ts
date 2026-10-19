import { extname, posix, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Maps a decoded URL path to a file inside `root`. Dot segments collapse at the root, so the result can
 * never leave it. Returns undefined for paths with NUL bytes.
 */
export function resolveWebPath(root: string, decodedPath: string): string | undefined {
  if (decodedPath.includes('\0')) return undefined;
  const relative = posix.normalize(`/${decodedPath}`).slice(1);
  const base = resolve(root);
  const file = resolve(base, relative);
  if (file !== base && !file.startsWith(base + sep)) return undefined;
  return file;
}
