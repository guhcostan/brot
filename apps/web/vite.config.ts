import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 5199 matches DEFAULT_WEB_PORT in packages/protocol/src/constants.ts. Config files load under plain
// Node ESM, which cannot resolve the protocol's extensionless TS imports, so the value is repeated here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
});
