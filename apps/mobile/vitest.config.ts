import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ui = (file: string) => fileURLToPath(new URL(`../../packages/ui/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@brot/ui/avatar': ui('avatar.ts'),
      '@brot/ui/blink': ui('blink.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
