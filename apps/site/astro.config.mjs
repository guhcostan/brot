import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://brot.dev',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [react()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'pt-BR', 'es'],
    routing: { prefixDefaultLocale: false },
  },
  build: { inlineStylesheets: 'auto' },
});
