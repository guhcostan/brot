import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const migrations = join(root, '../../packages/db/drizzle');

rmSync(dist, { recursive: true, force: true });

// Electron runs CommonJS. The db package finds its migrations with new URL('../drizzle', import.meta.url), so
// import.meta.url is pinned to dist/db/migrate.js and the migrations are copied to dist/drizzle beside it.
// electron, the libsql native client and playwright-core (used by the host browser) stay external, and
// electron-builder ships them from node_modules. Bundling playwright-core would drag its optional bidi
// requires into the bundle.
await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(dist, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  external: ['electron', '@libsql/client', 'playwright-core'],
  define: { 'import.meta.url': '__brotImportMetaUrl' },
  banner: {
    js: 'var __brotImportMetaUrl = require("node:url").pathToFileURL(require("node:path").join(__dirname, "db", "migrate.js")).href;',
  },
  logLevel: 'info',
});

cpSync(migrations, join(dist, 'drizzle'), { recursive: true });
