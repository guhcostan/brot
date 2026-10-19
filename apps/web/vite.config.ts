import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 5199 matches DEFAULT_WEB_PORT in packages/protocol/src/constants.ts, and 8799 matches
// DEFAULT_SERVER_PORT. Config files load under plain Node ESM, which cannot resolve the protocol's
// extensionless TS imports, so both values are repeated here. changeOrigin sends the server a Host
// header naming its own loopback address, which the server's loopback Host guard accepts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8799',
        changeOrigin: true,
      },
    },
  },
});
